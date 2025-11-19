import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

const ensureArray = (value: any): any[] => {
  if (Array.isArray(value)) {
    return value
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      // If it's a PostgreSQL array string like "{tag1,tag2}", parse it
      if (value.startsWith("{") && value.endsWith("}")) {
        const content = value.slice(1, -1)
        return content ? content.split(",").map((item) => item.trim().replace(/^"|"$/g, "")) : []
      }
      return []
    }
  }
  if (value === null || value === undefined) {
    return []
  }
  return []
}

// Storefront API route for retrieving a single blog article by slug (only published articles)
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    
    if (!pgConnection || typeof pgConnection !== "function") {
      return res.status(404).json({
        article: null,
        error: "Article not found"
      })
    }
    
    const slug = req.params.slug
    
    const [article] = await pgConnection("blog_article")
      .where({ url_slug: slug, draft: false })
      .select("*")
    
    if (!article) {
      return res.status(404).json({
        article: null,
        error: "Article not found"
      })
    }
    
    // Normalize article - parse JSON fields and ensure arrays
    if (article.body && typeof article.body === "string") {
      try {
        article.body = JSON.parse(article.body)
      } catch (e) {
        // Keep as string if parsing fails
      }
    }
    
    article.tags = ensureArray(article.tags)
    article.body_images = ensureArray(article.body_images)
    
    // Normalize thumbnail_image URL to ensure it's a full URL (like products do)
    // Products use product.thumbnail directly, which is already a full URL
    if (article.thumbnail_image && typeof article.thumbnail_image === 'string' && article.thumbnail_image.trim()) {
      // If it's already a full URL, use it as-is
      if (!article.thumbnail_image.startsWith('http://') && !article.thumbnail_image.startsWith('https://')) {
        // If it's a relative path, construct full URL
        const backendUrl = process.env.MEDUSA_BACKEND_URL || "http://localhost:9000"
        if (article.thumbnail_image.startsWith('/static') || article.thumbnail_image.startsWith('/uploads')) {
          article.thumbnail_image = `${backendUrl}${article.thumbnail_image}`
        } else if (article.thumbnail_image.startsWith('/')) {
          article.thumbnail_image = `${backendUrl}${article.thumbnail_image}`
        } else {
          // Assume it's a file path relative to /static
          article.thumbnail_image = `${backendUrl}/static/${article.thumbnail_image}`
        }
      }
    }
    
    return res.json({
      article: article
    })
  } catch (error: any) {
    console.error("Error fetching blog article:", error)
    return res.status(500).json({
      article: null,
      error: error?.message || "Unknown error"
    })
  }
}

