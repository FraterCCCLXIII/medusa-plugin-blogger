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

// Storefront API route for listing blog articles (only published articles)
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  try {
    const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    
    if (!pgConnection || typeof pgConnection !== "function") {
      return res.json({
        articles: [],
        count: 0
      })
    }
    
    const take = req.query.take ? parseInt(req.query.take as string) : 50
    const skip = req.query.skip ? parseInt(req.query.skip as string) : 0
    
    // Only get published articles (draft = false)
    const query = pgConnection("blog_article")
      .where({ draft: false })
      .orderBy("created_at", "desc")
      .limit(take)
      .offset(skip)
    
    const articles = await query.select("*")
    const countResult = await pgConnection("blog_article")
      .where({ draft: false })
      .count("* as count")
      .first()
    
    const count = countResult ? parseInt(countResult.count as string) : 0
    
    // Normalize articles - parse JSON fields and ensure arrays
    const normalizedArticles = (articles || []).map((article: any) => {
      // Parse body JSON
      if (article.body && typeof article.body === "string") {
        try {
          article.body = JSON.parse(article.body)
        } catch (e) {
          // Keep as string if parsing fails
        }
      }
      
      // Ensure tags and body_images are arrays
      article.tags = ensureArray(article.tags)
      article.body_images = ensureArray(article.body_images)
      
      return article
    })
    
    return res.json({
      articles: normalizedArticles,
      count: count
    })
  } catch (error: any) {
    console.error("Error fetching blog articles:", error)
    return res.json({
      articles: [],
      count: 0,
      error: error?.message || "Unknown error"
    })
  }
}
