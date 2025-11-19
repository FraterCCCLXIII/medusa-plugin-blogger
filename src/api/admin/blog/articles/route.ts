import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

const ensureArray = (value: any): any[] => {
  if (Array.isArray(value)) {
    return value
  }

  if (typeof value === "string") {
    const trimmed = value.trim()

    // Handle Postgres array string format: {value1,value2}
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      const content = trimmed.slice(1, -1)
      if (!content) {
        return []
      }
      return content
        .split(",")
        .map((item) => item.replace(/^"(.*)"$/, "$1").trim())
        .filter(Boolean)
    }

    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        return parsed
      }
      if (parsed) {
        return [parsed]
      }
    } catch {
      if (trimmed) {
        return [trimmed]
      }
    }
  }

  return []
}

// Admin API route for listing and creating blog articles
export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  try {
    console.log("[Blog API] GET /admin/blog/articles - Query params:", req.query)
    
    const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    if (!pgConnection || typeof pgConnection !== "function") {
      console.error("[Blog API] PG_CONNECTION not available")
      return res.json({
        articles: [],
        count: 0,
        error: "Database connection not available"
      })
    }
    
    const select = req.query.select ? JSON.parse(req.query.select as string) : ["*"]
    const skip = req.query.skip ? parseInt(req.query.skip as string) : 0
    const take = req.query.take ? parseInt(req.query.take as string) : 20
    const where = req.query.where ? JSON.parse(req.query.where as string) : {}
    
    console.log("[Blog API] Query params parsed:", { select, skip, take, where })
    
    // Build a raw SQL query using Knex
    let query = pgConnection("blog_article")
    
    // Apply select fields
    if (select.includes("*")) {
      query = query.select("*")
    } else {
      query = query.select(select)
    }
    
    // Build count query (before applying pagination)
    let countQuery = pgConnection("blog_article")
    
    // Apply where conditions to both queries
    if (Object.keys(where).length > 0) {
      Object.entries(where).forEach(([key, value]) => {
        // Handle special operators like $ilike for search
        if (typeof value === 'object' && value !== null && '$ilike' in value) {
          query = query.where(key, 'ilike', value.$ilike)
          countQuery = countQuery.where(key, 'ilike', value.$ilike)
        } else {
          query = query.where(key, value)
          countQuery = countQuery.where(key, value)
        }
      })
    }
    
    // Get total count
    const countResult = await countQuery.count("* as count").first()
    const count = countResult ? parseInt(countResult.count as string) : 0
    
    console.log("[Blog API] Total count:", count)
    
    // Apply pagination to main query
    query = query.orderBy("created_at", "desc").limit(take).offset(skip)
    
    const articles = await query
    
    console.log("[Blog API] Fetched articles count:", articles?.length || 0)

    // Parse JSON fields (body is stored as JSON)
    const parsedArticles = (articles || []).map((article: any) => {
      if (article.body && typeof article.body === "string") {
        try {
          article.body = JSON.parse(article.body)
        } catch (e) {
          // Keep as string if parsing fails
        }
      }
      article.tags = ensureArray(article.tags)
      article.body_images = ensureArray(article.body_images)
      return article
    })

    console.log("[Blog API] Returning response with", parsedArticles.length, "articles")

    return res.json({
      articles: parsedArticles,
      count: count,
      sanitized_query: {
        select,
        skip,
        take,
        where,
      }
    })
  } catch (error: any) {
    console.error("[Blog API] Error in GET /admin/blog/articles:", error)
    return res.json({
      articles: [],
      count: 0,
      error: error?.message || error?.toString() || "Unknown error",
      error_obj: error,
    })
  }
}

export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  // Note: Authentication is handled automatically by Medusa v2's middleware for /admin routes
  try {
    const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    
    if (!pgConnection || typeof pgConnection !== "function") {
      return res.json({
        success: false,
        error: "Database connection not available"
      })
    }
    
    const article = { ...req.body }
    
    // Generate ID if not provided
    if (!article.id) {
      article.id = `blog_article_${Date.now()}`
    } else if (!article.id.includes("blog_article_")) {
      article.id = `blog_article_${article.id}`
    }
    
    // Ensure draft is set (default to false)
    if (article.draft === undefined) {
      article.draft = false
    }
    
    // Ensure author is set (required field)
    if (!article.author) {
      // Try to get the current user's email or name
      const userId = req.auth_context?.actor_id
      if (userId) {
        try {
          // Try to get the user's email from the Query API
          const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
          const { data: [user] } = await query.graph({
            entity: "user",
            fields: ["email", "first_name", "last_name"],
            filters: { id: userId },
          })
          
          if (user) {
            // Use email, or first_name + last_name, or fallback to user ID
            article.author = user.email || 
                            (user.first_name && user.last_name ? `${user.first_name} ${user.last_name}` : null) ||
                            userId
          } else {
            article.author = userId
          }
        } catch (e) {
          // If we can't get user info, use the user ID
          article.author = userId || "Admin"
        }
      } else {
        article.author = "Admin"
      }
    }
    
    // Generate URL slug from title if not provided (required field)
    if (!article.url_slug && article.title) {
      // Create a URL-friendly slug from the title
      article.url_slug = article.title
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '') // Remove special characters
        .replace(/[\s_-]+/g, '-') // Replace spaces and underscores with hyphens
        .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
        + `-${Date.now()}` // Add timestamp to ensure uniqueness
    } else if (!article.url_slug) {
      // If no title, generate a unique slug
      article.url_slug = `article-${Date.now()}`
    }
    
    // Set SEO fields with defaults if not provided (some may be required)
    if (!article.seo_title) {
      // Use title as default SEO title, or generate one
      article.seo_title = article.title || `Article ${Date.now()}`
    }
    if (!article.seo_keywords) {
      article.seo_keywords = ""
    }
    if (!article.seo_description) {
      article.seo_description = article.subtitle || ""
    }
    
    // Set array fields with defaults if not provided
    if (!article.tags) {
      article.tags = []
    }
    if (!article.body_images) {
      article.body_images = []
    }
    if (!article.thumbnail_image) {
      article.thumbnail_image = ""
    }
    
    // Set timestamps
    const now = new Date()
    if (!article.created_at) {
      article.created_at = now
    }
    if (!article.updated_at) {
      article.updated_at = now
    }
    
    // Handle JSON fields (body is stored as JSON)
    if (article.body && typeof article.body === "object") {
      article.body = JSON.stringify(article.body)
    }
    
    // Insert the article using Knex
    const [newArticle] = await pgConnection("blog_article")
      .insert(article)
      .returning("*")
    
    // Parse JSON fields back
    if (newArticle.body && typeof newArticle.body === "string") {
      try {
        newArticle.body = JSON.parse(newArticle.body)
      } catch (e) {
        // Keep as string if parsing fails
      }
    }
    
    return res.json({
      success: true,
      article: newArticle,
    })
  } catch (error: any) {
    return res.json({
      success: false,
      error: error?.message || error?.toString() || "Unknown error",
      error_obj: error,
    })
  }
}
