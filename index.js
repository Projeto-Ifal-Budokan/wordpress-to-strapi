#!/usr/bin/env node
/**
 * WordPress ➜ Strapi migration script (Enhanced with Debug Support)
 *
 * Prerequisites:
 *   npm i axios form-data cheerio mime-types dotenv
 *
 * Environment variables (.env):
 *   WP_BASE_URL=https://legacy-blog.example.com
 *   STRAPI_BASE_URL=https://cms.example.com
 *   STRAPI_TOKEN=Your_Strapi_Admin_Token
 *   STRAPI_POST_CT=posts           # UID of Strapi collection (plural)
 *   DOWNLOAD_DIR=/tmp/wp-media     # optional temp directory
 *   DEBUG_LEVEL=info               # debug, info, warn, error
 *   DRY_RUN=false                  # true to skip actual creation/upload
 *   CONCURRENT_UPLOADS=3           # max concurrent file uploads
 *   RETRY_ATTEMPTS=3               # retry failed operations
 *
 * Usage:
 *   node index.js
 */

require('dotenv').config();

const axios = require('axios');
const FormData = require('form-data');
const cheerio = require('cheerio');
const mime = require('mime-types');
const path = require('path');
const fs = require('fs/promises');

const {
  WP_BASE_URL,
  STRAPI_BASE_URL,
  STRAPI_TOKEN,
  STRAPI_POST_CT,
  DOWNLOAD_DIR = '/tmp/wp-media',
  DEBUG_LEVEL = 'info',
  DRY_RUN = 'false',
  CONCURRENT_UPLOADS = '3',
  RETRY_ATTEMPTS = '3',
} = process.env;

// Configuration
const config = {
  dryRun: DRY_RUN.toLowerCase() === 'true',
  concurrentUploads: parseInt(CONCURRENT_UPLOADS, 10),
  retryAttempts: parseInt(RETRY_ATTEMPTS, 10),
  debugLevel: DEBUG_LEVEL.toLowerCase(),
};

// Debug levels hierarchy
const DEBUG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = DEBUG_LEVELS[config.debugLevel] ?? 1;

/**
 * Enhanced logging with levels and timestamps
 */
const logger = {
  debug: (msg, data = null) => {
    if (currentLevel <= DEBUG_LEVELS.debug) {
      console.log(`🔍 [DEBUG ${new Date().toISOString()}] ${msg}`);
      if (data) console.log('   Data:', JSON.stringify(data, null, 2));
    }
  },
  info: (msg, data = null) => {
    if (currentLevel <= DEBUG_LEVELS.info) {
      console.log(`ℹ️  [INFO  ${new Date().toISOString()}] ${msg}`);
      if (data) console.log('   Data:', data);
    }
  },
  warn: (msg, data = null) => {
    if (currentLevel <= DEBUG_LEVELS.warn) {
      console.warn(`⚠️  [WARN  ${new Date().toISOString()}] ${msg}`);
      if (data) console.warn('   Data:', data);
    }
  },
  error: (msg, error = null) => {
    if (currentLevel <= DEBUG_LEVELS.error) {
      console.error(`❌ [ERROR ${new Date().toISOString()}] ${msg}`);
      if (error) {
        console.error('   Error:', error.message || error);
        if (error.response) {
          console.error('   Status:', error.response.status);
          console.error('   Response:', error.response.data);
        }
      }
    }
  },
  success: (msg) => {
    console.log(`✅ [SUCCESS ${new Date().toISOString()}] ${msg}`);
  },
};

/**
 * Performance tracking
 */
class Timer {
  constructor(name) {
    this.name = name;
    this.start = Date.now();
  }
  
  end() {
    const duration = Date.now() - this.start;
    logger.debug(`Timer "${this.name}" completed in ${duration}ms`);
    return duration;
  }
}

/**
 * Retry wrapper for async operations
 */
async function withRetry(operation, context = 'operation', maxAttempts = config.retryAttempts) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await operation();
      if (attempt > 1) {
        logger.info(`${context} succeeded on attempt ${attempt}`);
      }
      return result;
    } catch (error) {
      logger.warn(`${context} failed on attempt ${attempt}/${maxAttempts}`, error.message);
      
      if (attempt === maxAttempts) {
        logger.error(`${context} failed after ${maxAttempts} attempts`, error);
        throw error;
      }
      
      // Exponential backoff
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
      logger.debug(`Retrying ${context} in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Validation
if (!WP_BASE_URL || !STRAPI_BASE_URL || !STRAPI_TOKEN || !STRAPI_POST_CT) {
  logger.error('Missing required environment variables. See header for details.');
  process.exit(1);
}

logger.info('Migration configuration:', {
  wpBaseUrl: WP_BASE_URL,
  strapiBaseUrl: STRAPI_BASE_URL,
  postCollectionType: STRAPI_POST_CT,
  downloadDir: DOWNLOAD_DIR,
  dryRun: config.dryRun,
  debugLevel: config.debugLevel,
  concurrentUploads: config.concurrentUploads,
  retryAttempts: config.retryAttempts,
});

const axiosWP = axios.create({ 
  baseURL: WP_BASE_URL,
  timeout: 30000,
});
const axiosStrapi = axios.create({
  baseURL: STRAPI_BASE_URL,
  headers: { Authorization: `Bearer ${STRAPI_TOKEN}` },
  timeout: 30000,
});

// Add request/response interceptors for debugging
axiosWP.interceptors.request.use(config => {
  logger.debug(`WP API Request: ${config.method?.toUpperCase()} ${config.url}`, config.params);
  return config;
});

axiosStrapi.interceptors.request.use(config => {
  logger.debug(`Strapi API Request: ${config.method?.toUpperCase()} ${config.url}`);
  return config;
});

/**
 * Comprehensive post count validation and comparison
 */
async function getComprehensivePostCount() {
  logger.info('🔍 Getting comprehensive post count from WordPress...');
  
  const counts = {
    published: 0,
    total_default: 0,
    total_all_statuses: 0,
    accessible_statuses: {},
    post_types: {},
    estimated_total: 0
  };

  // 1. Check default published posts count
  try {
    const response = await axiosWP.get('/wp-json/wp/v2/posts', {
      params: { per_page: 1, _fields: 'id' }
    });
    counts.published = Number(response.headers['x-wp-total'] || 0);
    counts.total_default = counts.published;
    logger.info(`📊 Default query (published): ${counts.published} posts`);
  } catch (error) {
    logger.error('Cannot get default post count:', error.message);
  }

  // 2. Try to get posts with any status (if permissions allow)
  const allStatuses = ['publish', 'draft', 'private', 'pending', 'future', 'trash'];
  
  for (const status of allStatuses) {
    try {
      const response = await axiosWP.get('/wp-json/wp/v2/posts', {
        params: { per_page: 1, status, _fields: 'id' }
      });
      const count = Number(response.headers['x-wp-total'] || 0);
      if (count > 0) {
        counts.accessible_statuses[status] = count;
        logger.info(`📊 ${status}: ${count} posts`);
      }
    } catch (error) {
      logger.debug(`Cannot access ${status} posts: ${error.response?.data?.message || error.message}`);
    }
  }

  // 3. Calculate estimated total from accessible statuses
  counts.estimated_total = Object.values(counts.accessible_statuses).reduce((sum, count) => sum + count, 0);

  // 4. Check different post types
  const postTypes = ['posts', 'pages'];
  for (const type of postTypes) {
    try {
      const endpoint = type === 'posts' ? '/wp-json/wp/v2/posts' : '/wp-json/wp/v2/pages';
      const response = await axiosWP.get(endpoint, {
        params: { per_page: 1, _fields: 'id' }
      });
      const count = Number(response.headers['x-wp-total'] || 0);
      counts.post_types[type] = count;
      if (count > 0) {
        logger.info(`📊 ${type}: ${count} items`);
      }
    } catch (error) {
      logger.debug(`Cannot access ${type}:`, error.message);
    }
  }

  // 5. Try alternative counting methods
  try {
    // Check if we can access WordPress stats
    const statsResponse = await axiosWP.get('/wp-json/wp/v2/posts', {
      params: { 
        per_page: 100,
        page: 1,
        _fields: 'id,status,type',
        context: 'view'
      }
    });
    
    if (statsResponse.data.length > 0) {
      const statusBreakdown = {};
      statsResponse.data.forEach(post => {
        statusBreakdown[post.status] = (statusBreakdown[post.status] || 0) + 1;
      });
      logger.info('📊 Sample status breakdown:', statusBreakdown);
    }
  } catch (error) {
    logger.debug('Cannot get detailed stats:', error.message);
  }

  // 6. Manual page count estimation
  try {
    let page = 1;
    let totalFound = 0;
    let maxPages = 50; // Safety limit
    
    logger.info('🔍 Manual pagination check...');
    
    while (page <= maxPages) {
      try {
        const response = await axiosWP.get('/wp-json/wp/v2/posts', {
          params: { 
            per_page: 100,
            page,
            _fields: 'id'
          }
        });
        
        if (response.data.length === 0) break;
        
        totalFound += response.data.length;
        logger.debug(`Page ${page}: found ${response.data.length} posts (total so far: ${totalFound})`);
        
        // If we got less than requested, we're at the end
        if (response.data.length < 100) break;
        
        page++;
      } catch (error) {
        if (error.response?.status === 400 && page > 1) {
          logger.debug(`Page ${page} returned 400, stopping manual count`);
          break;
        }
        throw error;
      }
    }
    
    counts.manual_count = totalFound;
    logger.info(`📊 Manual pagination count: ${totalFound} posts`);
    
  } catch (error) {
    logger.warn('Manual count failed:', error.message);
  }

  return counts;
}

/**
 * Enhanced WordPress post iterator with pre/post validation
 */
async function* wpPostIterator(perPage = 100) {
  let page = 1;
  let totalPages = 1;
  let totalPosts = 0;
  let processedPosts = 0;
  let allowedStatuses = ['publish'];

  logger.info('Starting WordPress post iteration...');

  // Get comprehensive counts BEFORE iteration
  const preCounts = await getComprehensivePostCount();
  
  // Determine the best approach based on what's accessible
  const accessibleStatuses = Object.keys(preCounts.accessible_statuses);
  if (accessibleStatuses.length > 0) {
    allowedStatuses = accessibleStatuses;
  }
  
  logger.info(`📋 Will fetch posts with statuses: ${allowedStatuses.join(', ')}`);
  logger.info(`📊 Expected total based on pre-check: ${preCounts.manual_count || preCounts.estimated_total || preCounts.published}`);

  // Main pagination loop with enhanced tracking
  const processedIds = new Set();
  
  while (page <= totalPages) {
    const timer = new Timer(`WP API fetch page ${page}`);
    
    try {
      const params = {
        per_page: perPage, 
        page, 
        _embed: true,
        orderby: 'id',
        order: 'asc'
      };

      // Add status only if we have specific accessible statuses
      if (allowedStatuses.length > 1 || allowedStatuses[0] !== 'publish') {
        params.status = allowedStatuses.join(',');
      }

      const { data, headers } = await withRetry(
        () => axiosWP.get('/wp-json/wp/v2/posts', { params }),
        `Fetching WP posts page ${page}`
      );

      timer.end();

      // Update pagination info
      const currentTotalPages = Number(headers['x-wp-totalpages'] || 1);
      const currentTotal = Number(headers['x-wp-total'] || 0);
      
      if (page === 1) {
        totalPages = currentTotalPages;
        totalPosts = currentTotal;
        logger.info(`📋 API reports: ${totalPages} pages, ${totalPosts} posts total`);
        
        // Compare with pre-check
        const expectedTotal = preCounts.manual_count || preCounts.estimated_total || preCounts.published;
        if (Math.abs(totalPosts - expectedTotal) > 0) {
          logger.warn(`⚠️  Count mismatch! API reports ${totalPosts}, pre-check found ${expectedTotal}`);
        }
      }

      logger.info(`📄 Page ${page}/${totalPages}: ${data.length} posts`);
      
      // Track and yield posts
      for (const post of data) {
        if (processedIds.has(post.id)) {
          logger.warn(`⚠️  Duplicate post ID ${post.id} on page ${page}`);
          continue;
        }
        
        processedIds.add(post.id);
        processedPosts++;
        
        yield { 
          post, 
          progress: { 
            current: processedPosts, 
            total: totalPosts, 
            page, 
            totalPages,
            pageSize: data.length,
            uniqueIds: processedIds.size
          } 
        };
      }
      
      page++;
      
      // Safety check
      if (page > 1000) {
        logger.error('❌ Safety check: Over 1000 pages. Stopping.');
        break;
      }
      
    } catch (error) {
      logger.error(`Failed to fetch WordPress posts page ${page}`, error);
      throw error;
    }
  }

  // Post-iteration validation
  logger.success(`✅ WordPress post iteration completed`);
  logger.info(`📊 Iteration results: ${processedPosts} posts, ${processedIds.size} unique IDs`);
  
  // Compare final counts
  const finalExpected = preCounts.manual_count || preCounts.estimated_total || preCounts.published;
  const completionRate = finalExpected > 0 ? (processedPosts / finalExpected * 100).toFixed(1) : 'N/A';
  
  logger.info(`📈 Completion rate: ${completionRate}% (${processedPosts}/${finalExpected})`);
  
  if (processedPosts < finalExpected) {
    const missing = finalExpected - processedPosts;
    logger.error(`❌ MISSING POSTS: ${missing} posts not found! Expected ${finalExpected}, got ${processedPosts}`);
    
    // Suggest reasons
    logger.info('🔍 Possible reasons for missing posts:');
    logger.info('   • Posts with restricted statuses (draft, private, etc.)');
    logger.info('   • Posts in custom post types not covered by /wp-json/wp/v2/posts');
    logger.info('   • API permissions limiting access');
    logger.info('   • Posts created after the pre-check');
  } else if (processedPosts > finalExpected) {
    logger.warn(`⚠️  Found MORE posts than expected: ${processedPosts} vs ${finalExpected}`);
  } else {
    logger.success(`✅ Perfect match! Found exactly ${processedPosts} posts as expected`);
  }
  
  return {
    processed: processedPosts,
    unique: processedIds.size,
    expected: finalExpected,
    preCounts
  };
}

/**
 * Detect which post statuses are accessible via the API
 */
async function detectAccessibleStatuses() {
  const statuses = ['publish', 'draft', 'private', 'pending', 'future'];
  const accessible = [];
  
  logger.info('🔍 Detecting accessible post statuses...');
  
  for (const status of statuses) {
    try {
      await axiosWP.get('/wp-json/wp/v2/posts', {
        params: { per_page: 1, status, _fields: 'id' }
      });
      accessible.push(status);
      logger.debug(`✅ Status '${status}' is accessible`);
    } catch (error) {
      logger.debug(`❌ Status '${status}' is not accessible: ${error.response?.data?.message || error.message}`);
    }
  }
  
  // If no individual statuses work, try the default (no status param)
  if (accessible.length === 0) {
    try {
      await axiosWP.get('/wp-json/wp/v2/posts', {
        params: { per_page: 1, _fields: 'id' }
      });
      accessible.push('publish'); // Default is published posts
      logger.debug('✅ Default query (published posts) is accessible');
    } catch (error) {
      logger.error('❌ Cannot access any posts via WordPress API', error);
    }
  }
  
  return accessible;
}

/**
 * Simplified validation function
 */
async function validatePostCollection() {
  logger.info('🔍 Validating WordPress post collection...');
  
  // Check published posts (this should always work)
  try {
    const response = await axiosWP.get('/wp-json/wp/v2/posts', {
      params: { per_page: 1, _fields: 'id' }
    });
    const count = Number(response.headers['x-wp-total'] || 0);
    logger.info(`📊 Published posts: ${count}`);
  } catch (error) {
    logger.error('❌ Cannot access published posts:', error.message);
    return false;
  }
  
  // Check pages separately
  try {
    const pageResponse = await axiosWP.get('/wp-json/wp/v2/pages', {
      params: { per_page: 1, _fields: 'id' }
    });
    const pageCount = Number(pageResponse.headers['x-wp-total'] || 0);
    if (pageCount > 0) {
      logger.info(`📄 Found ${pageCount} pages (not migrated by this script)`);
    }
  } catch (error) {
    logger.debug('Cannot access pages:', error.message);
  }
  
  // Test if we can access post details with _embed
  try {
    const detailResponse = await axiosWP.get('/wp-json/wp/v2/posts', {
      params: { per_page: 1, _embed: true }
    });
    if (detailResponse.data.length > 0) {
      const post = detailResponse.data[0];
      logger.info(`✅ Can access post details and embedded media`);
      logger.debug(`Sample post: "${post.title?.rendered}" (ID: ${post.id})`);
    }
  } catch (error) {
    logger.warn('⚠️  Cannot access embedded post data:', error.message);
  }
  
  return true;
}

/**
 * Collect every media URL (featured + inline <img>) used in a post.
 */
function collectMediaUrls(post) {
  const timer = new Timer(`Collect media URLs for post ${post.id}`);
  const urls = new Set();

  // Featured image first
  const fm = post._embedded?.['wp:featuredmedia']?.[0];
  if (fm?.source_url) {
    urls.add(fm.source_url);
    logger.debug(`Found featured media: ${fm.source_url}`);
  }

  // Inline images in HTML body
  const $ = cheerio.load(post.content?.rendered || '');
  $('img').each((_, img) => {
    const src = $(img).attr('src');
    if (src) {
      urls.add(src);
      logger.debug(`Found inline image: ${src}`);
    }
  });

  const urlList = [...urls];
  timer.end();
  
  logger.info(`Post "${post.title.rendered}" has ${urlList.length} media files`);
  return urlList;
}

// Cache to avoid re‑uploading the same asset
const fileCache = new Map(); // oldUrl => { id, url }
const migrationStats = {
  postsProcessed: 0,
  postsCreated: 0,
  mediaFilesUploaded: 0,
  mediaFilesCached: 0,
  errors: [],
  startTime: Date.now(),
};

/**
 * Download a file from WordPress and upload it to Strapi.
 */
async function migrateFile(oldUrl) {
  if (fileCache.has(oldUrl)) {
    logger.debug(`Using cached file for ${oldUrl}`);
    migrationStats.mediaFilesCached++;
    return fileCache.get(oldUrl);
  }

  const timer = new Timer(`Migrate file ${oldUrl}`);

  try {
    await fs.mkdir(DOWNLOAD_DIR, { recursive: true });

    const filename = path.basename(new URL(oldUrl).pathname);
    const tmpPath = path.join(DOWNLOAD_DIR, filename);

    logger.debug(`Downloading ${oldUrl} to ${tmpPath}`);

    // Download with retry
    const { data: buffer } = await withRetry(
      () => axios.get(oldUrl, { responseType: 'arraybuffer', timeout: 30000 }),
      `Downloading ${oldUrl}`
    );

    await fs.writeFile(tmpPath, buffer);
    logger.debug(`Downloaded ${buffer.length} bytes to ${tmpPath}`);

    if (config.dryRun) {
      logger.info(`[DRY RUN] Would upload ${filename} to Strapi`);
      const mockFile = { id: `mock-${Date.now()}`, url: `/mock/${filename}` };
      fileCache.set(oldUrl, mockFile);
      return mockFile;
    }

    // Upload to Strapi with retry
    const form = new FormData();
    form.append('files', buffer, {
      filename,
      contentType: mime.lookup(filename) || 'application/octet-stream',
    });

    logger.debug(`Uploading ${filename} to Strapi...`);
    
    const response = await withRetry(
      () => axiosStrapi.post('/api/upload', form, {
        headers: form.getHeaders(),
      }),
      `Uploading ${filename} to Strapi`
    );

    const file = response.data[0];
    const info = { id: file.id, url: file.url };
    
    fileCache.set(oldUrl, info);
    migrationStats.mediaFilesUploaded++;
    
    timer.end();
    logger.success(`Uploaded ${filename} → ${file.url}`);
    
    return info;

  } catch (error) {
    timer.end();
    logger.error(`Failed to migrate file ${oldUrl}`, error);
    migrationStats.errors.push({ type: 'media', url: oldUrl, error: error.message });
    throw error;
  }
}

/**
 * Upload multiple files with concurrency control
 */
async function migrateFiles(urls) {
  if (urls.length === 0) return new Map();

  logger.info(`Migrating ${urls.length} media files with concurrency limit of ${config.concurrentUploads}`);

  const results = [];
  
  // Process in batches to respect concurrency limit
  for (let i = 0; i < urls.length; i += config.concurrentUploads) {
    const batch = urls.slice(i, i + config.concurrentUploads);
    logger.debug(`Processing media batch ${Math.floor(i / config.concurrentUploads) + 1}: ${batch.length} files`);
    
    const batchResults = await Promise.allSettled(
      batch.map(async (url) => [url, await migrateFile(url)])
    );

    results.push(...batchResults);
  }

  // Process results
  const mappingEntries = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      mappingEntries.push(result.value);
    } else {
      logger.error('Media migration failed:', result.reason);
    }
  }

  return new Map(mappingEntries);
}

/**
 * Replace all old URLs in the HTML with new Strapi URLs.
 */
function rewriteHtml(html, mapOldToNew) {
  const timer = new Timer('HTML rewrite');
  let output = html;
  let replacements = 0;

  for (const [oldUrl, { url: newUrl }] of mapOldToNew) {
    const beforeLength = output.length;
    output = output.split(oldUrl).join(newUrl);
    const afterLength = output.length;
    
    if (beforeLength !== afterLength) {
      replacements++;
      logger.debug(`Replaced ${oldUrl} → ${newUrl}`);
    }
  }

  timer.end();
  logger.info(`HTML rewrite completed: ${replacements} URL replacements`);
  
  return output;
}

/**
 * Create Strapi post matching the exact schema provided
 */
async function createStrapiPost(wpPost, mapping) {
  const timer = new Timer(`Create Strapi post ${wpPost.id}`);

  try {
    const featuredOldUrl = wpPost._embedded?.['wp:featuredmedia']?.[0]?.source_url;
    const featuredNew = featuredOldUrl ? mapping.get(featuredOldUrl) : null;

    // Build payload matching your exact schema
    const payload = {
      data: {
        title: wpPost.title.rendered,
        slug: wpPost.slug,
        content: rewriteHtml(wpPost.content.rendered, mapping), // ✅ Now using "content"
        status: wpPost.status === 'publish' ? 'published' : 'draft', // ✅ Required field with correct enum values
        publishedAt: wpPost.status === 'publish' ? wpPost.date_gmt : null,
        author: 'Admin', // Default value from schema
        categories: [], // Default empty array
        tags: [] // Default empty array
      }
    };

    // Add optional fields
    if (featuredNew?.id) {
      payload.data.featuredImage = featuredNew.id; // ✅ Now using "featuredImage"
    }

    // Add excerpt if available (from WordPress excerpt or truncated content)
    if (wpPost.excerpt?.rendered && wpPost.excerpt.rendered.trim()) {
      // Clean excerpt and limit to 500 chars
      const cleanExcerpt = wpPost.excerpt.rendered
        .replace(/<[^>]*>/g, '') // Remove HTML tags
        .replace(/\[[^\]]*\]/, '') // Remove shortcodes
        .trim()
        .substring(0, 500);
      
      if (cleanExcerpt) {
        payload.data.excerpt = cleanExcerpt;
      }
    }

    // Calculate reading time (rough estimate: 200 words per minute)
    const wordCount = wpPost.content.rendered
      .replace(/<[^>]*>/g, '') // Remove HTML
      .split(/\s+/)
      .filter(word => word.length > 0).length;
    
    payload.data.readingTime = Math.max(1, Math.ceil(wordCount / 200));

    // Add meta fields for SEO
    payload.data.metaTitle = wpPost.title.rendered.substring(0, 60);
    
    if (wpPost.excerpt?.rendered) {
      const metaDesc = wpPost.excerpt.rendered
        .replace(/<[^>]*>/g, '')
        .trim()
        .substring(0, 160);
      if (metaDesc) {
        payload.data.metaDescription = metaDesc;
      }
    }

    logger.debug(`Creating Strapi post with correct schema:`, {
      title: payload.data.title,
      slug: payload.data.slug,
      status: payload.data.status,
      hasContent: !!payload.data.content,
      contentLength: payload.data.content?.length || 0,
      featuredImageId: payload.data.featuredImage,
      readingTime: payload.data.readingTime,
      requiredFields: ['title', 'slug', 'content', 'status'].map(field => `${field}: ${!!payload.data[field]}`)
    });

    if (config.dryRun) {
      logger.info(`[DRY RUN] Would create post "${payload.data.title}" in Strapi`);
      return { id: `mock-post-${wpPost.id}` };
    }

    const response = await withRetry(
      () => axiosStrapi.post(`/api/${STRAPI_POST_CT}`, payload),
      `Creating Strapi post "${wpPost.title.rendered}"`
    );

    migrationStats.postsCreated++;
    timer.end();
    
    logger.success(`Created Strapi post: "${wpPost.title.rendered}" (ID: ${response.data.data.id})`);
    return response.data.data;

  } catch (error) {
    timer.end();
    logger.error(`Failed to create Strapi post "${wpPost.title.rendered}"`, error);
    
    // Enhanced error logging with schema validation info
    if (error.response?.data?.error?.details?.errors) {
      logger.error('Schema validation errors:');
      error.response.data.error.details.errors.forEach((err, i) => {
        logger.error(`   ${i + 1}. ${err.path?.join('.')} - ${err.message}`);
      });
    }
    
    // Log the exact payload for debugging
    logger.debug('Failed payload:', JSON.stringify(payload, null, 2));
    
    migrationStats.errors.push({ 
      type: 'post', 
      wpId: wpPost.id, 
      title: wpPost.title.rendered, 
      error: error.message,
      details: error.response?.data
    });
    throw error;
  }
}

/**
 * Simplified validation function for your specific schema
 */
async function validateStrapiSchema() {
  logger.info('🔍 Validating Strapi connection with your schema...');
  
  try {
    // Test basic connection
    const healthResponse = await axiosStrapi.get('/api/posts?pagination[limit]=1');
    logger.success('✅ Strapi API connection successful');
    
    // Test creating a post with your exact schema
    const testPayload = {
      data: {
        title: 'Migration Test Post',
        slug: 'migration-test-post',
        content: '<p>This is a test post created during migration validation.</p>',
        status: 'draft', // Using draft to avoid publishing test content
        author: 'Admin',
        categories: [],
        tags: [],
        readingTime: 1
      }
    };
    
    try {
      const testResponse = await axiosStrapi.post(`/api/${STRAPI_POST_CT}`, testPayload);
      logger.success('✅ Post creation with your schema works perfectly!');
      
      // Clean up test post
      if (testResponse.data?.data?.id) {
        await axiosStrapi.delete(`/api/${STRAPI_POST_CT}/${testResponse.data.data.id}`);
        logger.debug('🧹 Cleaned up test post');
      }
      
      return { success: true };
    } catch (error) {
      logger.error('❌ Schema validation failed:', error.response?.data || error.message);
      
      if (error.response?.data?.error?.details?.errors) {
        logger.error('Detailed validation errors:');
        error.response.data.error.details.errors.forEach((err, i) => {
          logger.error(`   ${i + 1}. Field: ${err.path?.join('.')} - ${err.message}`);
        });
      }
      
      return { success: false, error: error.response?.data };
    }
    
  } catch (error) {
    logger.error('❌ Cannot connect to Strapi API:', error.response?.data || error.message);
    return { success: false, error: error.response?.data };
  }
}

/**
 * Print migration statistics
 */
function printStats() {
  const duration = Date.now() - migrationStats.startTime;
  const minutes = Math.floor(duration / 60000);
  const seconds = Math.floor((duration % 60000) / 1000);

  logger.info('\n📊 Migration Statistics:');
  logger.info(`   Duration: ${minutes}m ${seconds}s`);
  logger.info(`   Posts processed: ${migrationStats.postsProcessed}`);
  logger.info(`   Posts created: ${migrationStats.postsCreated}`);
  logger.info(`   Media files uploaded: ${migrationStats.mediaFilesUploaded}`);
  logger.info(`   Media files cached: ${migrationStats.mediaFilesCached}`);
  logger.info(`   Errors: ${migrationStats.errors.length}`);

  if (migrationStats.errors.length > 0) {
    logger.error('\n❌ Errors encountered:');
    migrationStats.errors.forEach((err, i) => {
      logger.error(`   ${i + 1}. ${err.type}: ${err.title || err.url} - ${err.error}`);
    });
  }
}

/**
 * Updated main routine with schema-specific validation
 */
(async function main() {
  logger.info('🚀 Starting WordPress ➜ Strapi migration…');
  
  if (config.dryRun) {
    logger.warn('🔍 DRY RUN MODE: No actual uploads or posts will be created');
  }

  try {
    // 1. Validate Strapi with your specific schema
    logger.info('\n=== STRAPI SCHEMA VALIDATION ===');
    const schemaValidation = await validateStrapiSchema();
    
    if (!schemaValidation.success) {
      logger.error('❌ Schema validation failed. Please check your Strapi content type configuration.');
      logger.error('Expected fields: title (string), slug (uid), content (richtext), status (enum), featuredImage (media)');
      process.exit(1);
    }

    // 2. WordPress validation
    logger.info('\n=== WORDPRESS VALIDATION ===');
    const initialCounts = await getComprehensivePostCount();
    
    // 3. Start migration
    const processedPostIds = new Set();
    let successCount = 0;
    let errorCount = 0;
    
    logger.info('\n=== MIGRATION PROCESSING ===');
    
    for await (const { post: wpPost, progress } of wpPostIterator()) {
      const postTimer = new Timer(`Process post ${wpPost.id}`);
      
      if (processedPostIds.has(wpPost.id)) {
        logger.warn(`⚠️  Duplicate post detected: ${wpPost.id}`);
        continue;
      }
      processedPostIds.add(wpPost.id);
      
      logger.info(`\n[${progress.current}/${progress.total}] Processing: "${wpPost.title.rendered}"`);
      migrationStats.postsProcessed++;

      try {
        const mediaUrls = collectMediaUrls(wpPost);
        const mapping = await migrateFiles(mediaUrls);
        await createStrapiPost(wpPost, mapping);
        
        successCount++;
        postTimer.end();
        
      } catch (error) {
        errorCount++;
        postTimer.end();
        logger.error(`Failed to process post "${wpPost.title.rendered}"`, error);
        continue;
      }
    }

    // 4. Final summary
    logger.info('\n=== MIGRATION SUMMARY ===');
    logger.info(`📊 WordPress posts found: ${initialCounts.manual_count || initialCounts.published}`);
    logger.info(`📊 Posts processed: ${processedPostIds.size}`);
    logger.info(`✅ Successfully migrated: ${successCount}`);
    logger.info(`❌ Failed migrations: ${errorCount}`);
    
    printStats();
    
    if (errorCount === 0) {
      logger.success(`🎉 Perfect migration! All ${successCount} posts migrated successfully!`);
    } else {
      logger.warn(`⚠️  Migration completed with ${errorCount} errors.`);
    }

  } catch (error) {
    logger.error('💥 Migration failed', error);
    printStats();
    process.exit(1);
  }
})().catch((err) => {
  logger.error('💥 Unhandled migration error', err);
  printStats();
  process.exit(1);
});

