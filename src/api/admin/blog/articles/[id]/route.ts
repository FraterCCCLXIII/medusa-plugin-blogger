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

export const GET = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  try {
    const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    
    if (!pgConnection || typeof pgConnection !== "function") {
      return res.json({
        success: false,
        error: "Database connection not available"
      })
    }
    
    let id = req.params.id
    if (!id.includes("blog_article_")) {
      id = `blog_article_${id}`
    }
    
    const [article] = await pgConnection("blog_article")
      .where({ id })
      .select("*")
    
    if (!article) {
      return res.json({
        success: false,
        error: "Article not found"
      })
    }
    
    // Parse JSON fields (body and metadata are stored as JSON)
    if (article.body && typeof article.body === "string") {
      try {
        article.body = JSON.parse(article.body)
      } catch (e) {
        // Keep as string if parsing fails
      }
    }
    if (article.metadata !== null && article.metadata !== undefined) {
      if (typeof article.metadata === "string") {
        try {
          article.metadata = JSON.parse(article.metadata)
        } catch (e) {
          // Keep as string if parsing fails
        }
      }
    } else {
      article.metadata = null
    }

    // Ensure array fields are arrays
    article.tags = ensureArray(article.tags)
    article.body_images = ensureArray(article.body_images)
    
    return res.json({
      success: true,
      article: article,
    })
  } catch (error: any) {
    return res.json({
      success: false,
      error: error?.message || error?.toString() || "Unknown error",
      error_obj: error,
    })
  }
}

export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  try {
    const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    
    if (!pgConnection || typeof pgConnection !== "function") {
      return res.json({
        success: false,
        error: "Database connection not available"
      })
    }
    
    let id = req.params.id
    if (!id.includes("blog_article_")) {
      id = `blog_article_${id}`
    }
    
    // Check if article exists
    const [existingArticle] = await pgConnection("blog_article")
      .where({ id })
      .select("*")
    
    if (!existingArticle) {
      return res.json({
        success: false,
        error: "The ID does not match any article"
      })
    }
    
    // Handle draft status change
    if (req.body.change_draft_status) {
      // Parse body if it's a string to check if it's empty
      let parsedBody = existingArticle.body
      if (typeof existingArticle.body === "string") {
        try {
          parsedBody = JSON.parse(existingArticle.body)
        } catch (e) {
          // If parsing fails, treat as empty
          parsedBody = null
        }
      }
      
      // Validate that article has content before allowing publish
      const isBodyEmpty = !parsedBody || 
                         (typeof parsedBody === "object" && (!parsedBody.blocks || !Array.isArray(parsedBody.blocks) || parsedBody.blocks.length === 0)) ||
                         (typeof parsedBody === "string" && parsedBody.trim() === "")
      
      const isTitleEmpty = !existingArticle.title || existingArticle.title.trim() === ""
      
      // If trying to publish (draft = false), ensure article has content
      if (req.body.draft === false && (isBodyEmpty || isTitleEmpty)) {
        return res.json({
          success: false,
          error: "You cannot changed the draft status if the article is empty or the article is not saved"
        })
      }
      
      const [updatedArticle] = await pgConnection("blog_article")
        .where({ id })
        .update({ draft: req.body.draft, updated_at: new Date() })
        .returning("*")
      
      // Parse JSON fields
      if (updatedArticle.body && typeof updatedArticle.body === "string") {
        try {
          updatedArticle.body = JSON.parse(updatedArticle.body)
        } catch (e) {
          // Keep as string if parsing fails
        }
      }
      if (updatedArticle.metadata !== null && updatedArticle.metadata !== undefined) {
        if (typeof updatedArticle.metadata === "string") {
          try {
            updatedArticle.metadata = JSON.parse(updatedArticle.metadata)
          } catch (e) {
            // Keep as string if parsing fails
          }
        }
      } else {
        updatedArticle.metadata = null
      }
      
      // Ensure array fields are arrays
      updatedArticle.tags = ensureArray(updatedArticle.tags)
      updatedArticle.body_images = ensureArray(updatedArticle.body_images)
      
      return res.json({
        success: true,
        article: updatedArticle,
      })
    }
    
    // Update article - prepare update data
    const updateData: any = {}
    
    // ALL fields in blog_article have NOT NULL constraints, so we must use empty strings, not null
    // Handle null/undefined/empty values explicitly
    Object.keys(req.body).forEach(key => {
      if (key !== "id" && key !== "created_at" && key !== "updated_at" && key !== "change_draft_status") {
        const value = req.body[key]
        
        // Explicitly handle null, undefined, and empty string values
        // Since all fields have NOT NULL constraints, we convert null/undefined to empty string or empty array
        if (value === null || value === undefined) {
          // For text fields, use empty string (NOT NULL constraint)
          // For JSON fields (metadata, tags, body_images), use empty object or array
          if (key === 'metadata') {
            updateData[key] = null // metadata can be null
          } else if (key === 'tags' || key === 'body_images') {
            updateData[key] = [] // Use empty array for JSON array fields
          } else {
            updateData[key] = "" // Use empty string for text fields (NOT NULL constraint)
          }
        } else if (value === "") {
          // Empty string is already valid for NOT NULL text fields
          updateData[key] = ""
        } else {
          // Non-empty value, include it
          updateData[key] = value
        }
      }
    })
    
    // Handle metadata specially - if metadata is provided, it should replace existing metadata
    // Empty strings in metadata should be treated as deletions
    if (updateData.metadata !== undefined) {
      if (updateData.metadata === null || (typeof updateData.metadata === 'object' && Object.keys(updateData.metadata).length === 0)) {
        // If metadata is null or empty object, set it to null
        updateData.metadata = null
      } else if (typeof updateData.metadata === 'object') {
        // Remove keys with empty string values (deletions)
        const cleanedMetadata: any = {}
        Object.keys(updateData.metadata).forEach(key => {
          if (updateData.metadata[key] !== "" && updateData.metadata[key] !== null && updateData.metadata[key] !== undefined) {
            cleanedMetadata[key] = updateData.metadata[key]
          }
        })
        // If all keys were removed, set to null
        if (Object.keys(cleanedMetadata).length === 0) {
          updateData.metadata = null
        } else {
          updateData.metadata = cleanedMetadata
        }
      }
    }
    
    // Only set defaults for fields that are NOT in the update (undefined), not for fields explicitly set to empty/null
    // If a field is explicitly set to empty string or null (which we converted to empty string), respect that
    // Only apply defaults if the field is completely missing from the update
    if (!('seo_title' in updateData) && !existingArticle.seo_title) {
      updateData.seo_title = updateData.title || existingArticle.title || `Article ${Date.now()}`
    }
    if (!('seo_keywords' in updateData) && !existingArticle.seo_keywords) {
      updateData.seo_keywords = ""
    }
    if (!('seo_description' in updateData) && !existingArticle.seo_description) {
      updateData.seo_description = updateData.subtitle || existingArticle.subtitle || ""
    }
    if (!('author' in updateData) && !existingArticle.author) {
      // Try to get the current user's email or name
      const userId = req.auth_context?.actor_id
      if (userId) {
        try {
          const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
          const { data: [user] } = await query.graph({
            entity: "user",
            fields: ["email", "first_name", "last_name"],
            filters: { id: userId },
          })
          
          if (user) {
            updateData.author = user.email || 
                            (user.first_name && user.last_name ? `${user.first_name} ${user.last_name}` : null) ||
                            userId
          } else {
            updateData.author = userId
          }
        } catch (e) {
          updateData.author = userId || "Admin"
        }
      } else {
        updateData.author = "Admin"
      }
    }
    // Only set defaults for fields that are NOT in the update (not present in updateData)
    // If a field is explicitly set (even to empty string), respect that
    if (!('url_slug' in updateData) && !existingArticle.url_slug) {
      const title = updateData.title || existingArticle.title
      if (title) {
        updateData.url_slug = title
          .toLowerCase()
          .trim()
          .replace(/[^\w\s-]/g, '')
          .replace(/[\s_-]+/g, '-')
          .replace(/^-+|-+$/g, '')
          + `-${Date.now()}`
      } else {
        updateData.url_slug = `article-${Date.now()}`
      }
    }
    
    // Set array fields with defaults if not provided (not present in updateData)
    if (!('tags' in updateData) && !existingArticle.tags) {
      updateData.tags = []
    }
    if (!('body_images' in updateData) && !existingArticle.body_images) {
      updateData.body_images = []
    }
    // Don't set thumbnail_image to empty string - only update if explicitly provided
    // If thumbnail_image is not in updateData, don't include it in the update (preserve existing value)
    if (!('thumbnail_image' in updateData)) {
      delete updateData.thumbnail_image
    }
    
    // Don't set fields to null - only update what's provided
    updateData.updated_at = new Date()
    
    // Handle JSON fields (body and metadata are stored as JSON)
    if (updateData.body && typeof updateData.body === "object") {
      updateData.body = JSON.stringify(updateData.body)
    }
    if (updateData.metadata !== undefined) {
      if (updateData.metadata === null) {
        updateData.metadata = null
      } else if (typeof updateData.metadata === "object") {
        updateData.metadata = JSON.stringify(updateData.metadata)
      }
      // If it's already a string, keep it as is
    }
    
    // Handle JSON array fields (tags, body_images)
    if (updateData.tags !== undefined && Array.isArray(updateData.tags)) {
      updateData.tags = JSON.stringify(updateData.tags)
    }
    if (updateData.body_images !== undefined && Array.isArray(updateData.body_images)) {
      updateData.body_images = JSON.stringify(updateData.body_images)
    }
    
    // Use Knex's update with explicit handling of empty strings
    // Knex should handle empty strings correctly, but we'll ensure they're included
    const [updatedArticle] = await pgConnection("blog_article")
      .where({ id })
      .update(updateData)
      .returning("*")
    
    // Parse JSON fields back
    if (updatedArticle.body && typeof updatedArticle.body === "string") {
      try {
        updatedArticle.body = JSON.parse(updatedArticle.body)
      } catch (e) {
        // Keep as string if parsing fails
      }
    }
    if (updatedArticle.metadata !== null && updatedArticle.metadata !== undefined) {
      if (typeof updatedArticle.metadata === "string") {
        try {
          updatedArticle.metadata = JSON.parse(updatedArticle.metadata)
        } catch (e) {
          // Keep as string if parsing fails
        }
      }
    } else {
        updatedArticle.metadata = null
    }
    
    // Ensure array fields are arrays
    updatedArticle.tags = ensureArray(updatedArticle.tags)
    updatedArticle.body_images = ensureArray(updatedArticle.body_images)
    
    return res.json({
      success: true,
      article: updatedArticle,
    })
  } catch (error: any) {
    return res.json({
      success: false,
      error: error?.message || error?.toString() || "Unknown error",
      error_obj: error,
    })
  }
}

export const DELETE = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
  try {
    const pgConnection = req.scope.resolve(ContainerRegistrationKeys.PG_CONNECTION)
    
    if (!pgConnection || typeof pgConnection !== "function") {
      return res.json({
        success: false,
        error: "Database connection not available"
      })
    }
    
    let id = req.params.id
    if (!id.includes("blog_article_")) {
      id = `blog_article_${id}`
    }
    
    const [deletedArticle] = await pgConnection("blog_article")
      .where({ id })
      .delete()
      .returning("*")
    
    return res.json({
      success: true,
      article: deletedArticle,
    })
  } catch (error: any) {
    return res.json({
      success: false,
      error: error?.message || error?.toString() || "Unknown error",
      error_obj: error,
    })
  }
}
