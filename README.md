# WordPress to Strapi Migration Tool

A comprehensive, enterprise-grade migration tool for transferring content from WordPress to Strapi CMS with advanced features including media migration, retry logic, concurrent uploads, and detailed progress tracking.

![Migration Status](https://img.shields.io/badge/status-production%20ready-green)
![Node Version](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen)
![License](https://img.shields.io/badge/license-ISC-blue)

## ✨ Features

### Core Migration Capabilities
- **Complete Post Migration**: Transfers all WordPress posts with full content, metadata, and formatting
- **Media File Handling**: Automatically downloads and uploads images, maintaining references
- **Content Rewriting**: Updates all image URLs in post content to point to new Strapi media
- **Schema Validation**: Validates both WordPress and Strapi schemas before migration
- **Multiple Post Statuses**: Supports published, draft, private, and other post statuses

### Enterprise Features
- **Concurrent Processing**: Configurable concurrent file uploads for faster migration
- **Retry Logic**: Automatic retry with exponential backoff for failed operations
- **Comprehensive Logging**: Multi-level debug system with timestamps and progress tracking
- **Dry Run Mode**: Test migrations without creating actual content
- **Progress Tracking**: Real-time progress indicators with statistics
- **Error Recovery**: Detailed error reporting and graceful failure handling
- **Memory Optimization**: Efficient processing of large content databases

### Advanced Capabilities
- **Duplicate Detection**: Prevents duplicate content creation
- **File Caching**: Avoids re-uploading identical media files
- **Post Count Validation**: Comprehensive pre and post-migration validation
- **Performance Monitoring**: Built-in timing and performance metrics
- **Flexible Configuration**: Extensive environment-based configuration

## 📋 Prerequisites

### System Requirements
- **Node.js**: Version 14.0.0 or higher
- **Package Manager**: npm, yarn, or pnpm
- **Memory**: Minimum 2GB RAM recommended for large migrations
- **Disk Space**: Temporary storage for media files during migration

### Access Requirements
- **WordPress**: REST API access to source WordPress site
- **Strapi**: Admin API access with content creation permissions
- **Network**: Reliable internet connection for API calls and media downloads

## 🚀 Installation

### 1. Clone or Download

```bash
# Clone if using git
git clone https://github.com/Projeto-Ifal-Budokan/wordpress-to-strapi.git
cd wordpress-to-strapi

# Or download and extract the files
```

### 2. Install Dependencies

```bash
# Using npm
npm install

# Using yarn
yarn install

# Using pnpm
pnpm install
```

### 3. Environment Configuration

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

## ⚙️ Configuration

### Required Environment Variables

```env
# WordPress Configuration
WP_BASE_URL=https://your-wordpress-site.com

# Strapi Configuration  
STRAPI_BASE_URL=https://your-strapi-instance.com
STRAPI_TOKEN=your_strapi_admin_token_here
STRAPI_POST_CT=posts
```

### Optional Environment Variables

```env
# Media Configuration
DOWNLOAD_DIR=/tmp/wp-media              # Temporary directory for media files

# Performance Tuning
CONCURRENT_UPLOADS=3                    # Max concurrent file uploads (1-10)
RETRY_ATTEMPTS=3                       # Retry failed operations (1-5)

# Debugging & Testing
DEBUG_LEVEL=info                       # debug, info, warn, error
DRY_RUN=false                          # Set to 'true' for testing without changes

# Advanced Configuration
WP_API_TIMEOUT=30000                   # WordPress API timeout (ms)
STRAPI_API_TIMEOUT=30000               # Strapi API timeout (ms)
```

### Getting Your Strapi Token

1. Log into your Strapi admin panel
2. Go to **Settings** → **API Tokens**
3. Click **Create new API Token**
4. Set the following:
   - **Name**: `WordPress Migration`
   - **Description**: `Token for WordPress content migration`
   - **Token duration**: Choose appropriate duration
   - **Token type**: `Full access` or `Custom` with content permissions
5. Save and copy the generated token

## 📊 Strapi Content Type Schema

The migration tool expects a specific Strapi content type schema. Create a content type called `posts` with these fields:

### Required Fields
```typescript
{
  title: string (Text),
  slug: string (UID, attached to title),
  content: richtext (Rich text),
  status: enumeration ['draft', 'published', 'archived'],
  publishedAt: datetime,
  author: string (Text, default: 'Admin'),
  categories: relation (many-to-many with categories, optional),
  tags: relation (many-to-many with tags, optional)
}
```

### Optional Fields (Auto-populated)
```typescript
{
  featuredImage: media (Single media),
  excerpt: text (500 char limit),
  readingTime: number (Integer),
  metaTitle: string (60 char limit),
  metaDescription: text (160 char limit)
}
```

### Schema Creation Steps

1. In Strapi admin, go to **Content-Type Builder**
2. Create a new **Collection Type** named `posts`
3. Add the required fields with exact names and types above
4. Configure the `status` enum with values: `draft`, `published`, `archived`
5. Set `publishedAt` to allow null values
6. Save and restart Strapi

## 🎯 Usage

### Basic Migration

```bash
# Run the migration
node index.js
```

### Test Run (Recommended First)

```bash
# Set DRY_RUN=true in .env file, then run
DEBUG_LEVEL=debug DRY_RUN=true node index.js
```

### Advanced Usage Examples

```bash
# High verbosity for debugging
DEBUG_LEVEL=debug node index.js

# Performance optimized for large sites
CONCURRENT_UPLOADS=5 RETRY_ATTEMPTS=5 node index.js

# Conservative migration with detailed logging
CONCURRENT_UPLOADS=1 DEBUG_LEVEL=info node index.js
```

## 📈 Migration Process

### Phase 1: Validation
1. **Strapi Schema Validation**: Verifies content type structure
2. **WordPress API Access**: Tests API connectivity and permissions
3. **Post Count Analysis**: Comprehensive post counting and validation

### Phase 2: Data Collection
1. **Post Enumeration**: Discovers all accessible WordPress posts
2. **Media Inventory**: Catalogs all media files (featured images + inline images)
3. **Content Analysis**: Parses HTML content for embedded assets

### Phase 3: Migration
1. **Media Migration**: Downloads and uploads files to Strapi with caching
2. **Content Transformation**: Converts WordPress post format to Strapi schema
3. **URL Rewriting**: Updates all media references in post content
4. **Post Creation**: Creates posts in Strapi with proper relationships

### Phase 4: Validation
1. **Completion Verification**: Confirms all posts were processed
2. **Statistics Report**: Provides detailed migration statistics
3. **Error Summary**: Lists any issues encountered during migration

## 🔧 Troubleshooting

### Common Issues

#### Authentication Errors
```bash
# Error: Unauthorized (401)
# Solution: Verify your STRAPI_TOKEN has proper permissions
```

#### Schema Validation Failures
```bash
# Error: Schema validation failed
# Solution: Ensure your Strapi content type matches the required schema exactly
```

#### Memory Issues
```bash
# Error: JavaScript heap out of memory
# Solution: Reduce CONCURRENT_UPLOADS or process in smaller batches
```

#### Network Timeouts
```bash
# Error: Request timeout
# Solution: Increase timeout values or check network connectivity
```

### Debug Mode

Enable detailed debugging:

```bash
DEBUG_LEVEL=debug node index.js 2>&1 | tee migration.log
```

### Performance Optimization

For large sites (1000+ posts):

```env
CONCURRENT_UPLOADS=2
RETRY_ATTEMPTS=5
DEBUG_LEVEL=warn
DOWNLOAD_DIR=/tmp/wp-media-large
```

For small sites (fast migration):

```env
CONCURRENT_UPLOADS=8
RETRY_ATTEMPTS=2
DEBUG_LEVEL=info
```

## 📊 Migration Statistics

The tool provides comprehensive statistics:

```
📊 Migration Statistics:
   Duration: 15m 32s
   Posts processed: 250
   Posts created: 248
   Media files uploaded: 523
   Media files cached: 89
   Errors: 2
```

### Understanding the Output

- **Posts processed**: WordPress posts discovered and processed
- **Posts created**: Successfully created Strapi posts
- **Media files uploaded**: New files uploaded to Strapi
- **Media files cached**: Files reused from previous uploads
- **Errors**: Failed operations (detailed in error log)

## 🔍 Post-Migration Checklist

### Content Verification
- [ ] Verify post count matches between WordPress and Strapi
- [ ] Check random posts for content accuracy
- [ ] Verify all images display correctly
- [ ] Test internal links and media references

### SEO Considerations
- [ ] Verify meta titles and descriptions
- [ ] Check slug formats and uniqueness
- [ ] Ensure proper canonical URLs
- [ ] Update any hardcoded WordPress URLs

### Performance Optimization
- [ ] Optimize uploaded images if needed
- [ ] Configure Strapi media optimization
- [ ] Set up CDN for media delivery
- [ ] Clear any temporary files from DOWNLOAD_DIR

## 🔒 Security Considerations

### API Token Security
- Use tokens with minimal required permissions
- Rotate tokens after migration completion
- Never commit tokens to version control
- Use environment variables for all sensitive data

### Data Privacy
- Review migrated content for sensitive information
- Ensure compliance with data protection regulations
- Clean up temporary files containing downloaded content
- Verify user data handling according to your privacy policy

## 🛠 Development & Customization

### Extending the Migration

The tool is designed for extensibility:

```javascript
// Custom post processing
function customPostProcessor(wpPost) {
  // Add custom logic here
  return enhancedPost;
}

// Custom media handling
function customMediaProcessor(mediaUrl) {
  // Add custom media processing
  return processedUrl;
}
```

### Adding New Fields

To migrate additional WordPress fields:

1. Update the Strapi content type schema
2. Modify the `createStrapiPost` function in `index.js`
3. Add field mapping logic

### Custom Content Types

To migrate to different Strapi content types:

1. Update `STRAPI_POST_CT` environment variable
2. Adjust the payload structure in `createStrapiPost`
3. Update schema validation logic

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Submit a pull request with a clear description

### Development Setup

```bash
# Install dependencies
pnpm install

# Run in development mode
DEBUG_LEVEL=debug DRY_RUN=true node index.js

# Run tests (when available)
npm test
```

## 📝 License

This project is licensed under the ISC License. See the `package.json` file for details.

## 🆘 Support

### Getting Help

1. **Check the troubleshooting section** above for common issues
2. **Enable debug logging** to get detailed information about errors
3. **Verify your configuration** against the requirements
4. **Test with a small subset** using DRY_RUN mode first

### Reporting Issues

When reporting issues, please include:

- Your environment configuration (without sensitive tokens)
- WordPress version and API status
- Strapi version and content type configuration
- Complete error logs with DEBUG_LEVEL=debug
- Steps to reproduce the issue

### Performance Issues

For large migrations:

- Consider running during off-peak hours
- Monitor server resources on both WordPress and Strapi
- Use conservative concurrency settings initially
- Test with a subset of content first

---

**Made with ❤️ for seamless WordPress to Strapi migrations**

*This tool has been tested with WordPress 5.0+ and Strapi 4.0+* 