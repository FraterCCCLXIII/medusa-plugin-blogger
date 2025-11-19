import React from "react"
import Medusa from "@medusajs/js-sdk"

// Import Tanstack Query v4 for medusa-react compatibility
// medusa-react v9 requires Tanstack Query v4 API, but Medusa v2 uses v5
// We need to use v4's QueryClient and QueryClientProvider for medusa-react
// Note: This creates a separate QueryClient instance for the plugin
import { QueryClient as QueryClientV4, QueryClientProvider as QueryClientProviderV4 } from "@tanstack/react-query"

// Create a SINGLETON QueryClient instance for medusa-react (v4 API)
// This ensures the same query cache is used across all component mounts/unmounts
// and prevents duplicate data accumulation when navigating between pages
let queryClientInstance: QueryClientV4 | null = null

const getQueryClient = (): QueryClientV4 => {
  if (!queryClientInstance) {
    queryClientInstance = new QueryClientV4({
      defaultOptions: {
        queries: {
          refetchOnWindowFocus: false,
          // Clear stale data to prevent accumulation
          staleTime: 0,
          cacheTime: 0,
        },
        mutations: {
          // Transform upload responses in the default onSuccess
          // This runs before individual mutation onSuccess callbacks
          onSuccess: (data, variables, context) => {
            console.log("[MedusaProvider] Mutation success:", {
              dataType: typeof data,
              dataKeys: data && typeof data === 'object' ? Object.keys(data) : 'N/A',
              data: data,
              variablesType: typeof variables,
              variables: variables,
            })
            
            // Transform upload responses: { files: [...] } -> { uploads: [...] }
            if (variables instanceof File) {
              if (data && typeof data === 'object' && 'files' in data && !('uploads' in data)) {
                console.log("[MedusaProvider] Transforming upload response in default onSuccess")
                // Note: We can't modify data here, but we can log it
                // The transformation happens in the mutation cache subscription below
              }
            }
          },
          onError: (error, variables, context) => {
            console.error("[MedusaProvider] Mutation error:", {
              error: error,
              errorMessage: error?.message,
              errorStack: error?.stack,
              variables: variables,
            })
          },
        },
      },
    })

    // Intercept mutations to transform upload responses
    // We'll wrap the mutationFn to transform results before they're stored
    const mutationCache = queryClientInstance.getMutationCache()

    // Override the mutation cache's build method to wrap mutationFn
    const originalBuild = mutationCache.build.bind(mutationCache)
    mutationCache.build = function(queryClient: any, options: any, state?: any) {
      // Wrap the mutationFn to transform upload responses and ensure empty values are sent
      if (options?.mutationFn) {
        const originalMutationFn = options.mutationFn
        options.mutationFn = async (...args: any[]) => {
          // Intercept blog article saves to ensure empty values are included
          const variables = args[0]
          if (variables && typeof variables === 'object' && !(variables instanceof File)) {
            // Check if this looks like a blog article save (has article fields)
            const hasArticleFields = 'title' in variables || 'author' in variables || 'seo_title' in variables || 'url_slug' in variables
            
            if (hasArticleFields) {
              // Get all form fields directly from the DOM
              // This ensures we capture empty values even if the plugin filters them out
              const form = document.querySelector('form') || document
              const formEntries: Record<string, any> = {}
              
              // Field name mapping (plugin uses kebab-case, API expects snake_case)
              const fieldMap: Record<string, string> = {
                'seo-title': 'seo_title',
                'seo-keywords': 'seo_keywords',
                'seo-description': 'seo_description',
                'url-slug': 'url_slug',
              }

              // Get all input, textarea, and select elements
              const inputs = form.querySelectorAll('input, textarea, select')
              inputs.forEach((input: any) => {
                const name = input.name || input.id
                if (name) {
                  // Map field names
                  const mappedName = fieldMap[name] || name.replace(/-/g, '_')
                  
                  // Get the current value
                  let value: any = input.value
                  
                  // Handle empty values - explicitly set to empty string
                  if (value === '' || value === null || value === undefined) {
                    formEntries[mappedName] = ''
                  } else {
                    formEntries[mappedName] = value
                  }
                }
              })

              // Also check for specific fields
              const specificFields = ['author', 'seo_title', 'seo_keywords', 'seo_description', 'url_slug', 'subtitle']
              specificFields.forEach(fieldName => {
                // Try different selectors
                const selectors = [
                  `[name="${fieldName}"]`,
                  `[id="${fieldName}"]`,
                  `[name="${fieldName.replace(/_/g, '-')}"]`,
                  `[id="${fieldName.replace(/_/g, '-')}"]`,
                ]
                
                for (const selector of selectors) {
                  const input = form.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement
                  if (input) {
                    const value = input.value
                    if (value === '' || value === null || value === undefined) {
                      formEntries[fieldName] = ''
                    } else {
                      formEntries[fieldName] = value
                    }
                    break
                  }
                }
              })

              // Handle tags field specially (it's a Tagify component)
              const tagsInput = form.querySelector('[name="tags"], [id="tags"]') as HTMLInputElement
              if (tagsInput) {
                // Tagify stores data in a data attribute or as a JSON string
                const tagifyInstance = (tagsInput as any).tagify
                if (tagifyInstance) {
                  const tags = tagifyInstance.value || []
                  formEntries.tags = Array.isArray(tags) ? tags : []
                } else {
                  // Fallback: try to parse from input value
                  try {
                    const tags = JSON.parse(tagsInput.value || '[]')
                    formEntries.tags = Array.isArray(tags) ? tags : []
                  } catch {
                    formEntries.tags = []
                  }
                }
              }

              // Merge form data with mutation variables
              // Form data takes precedence to ensure empty values are included
              const mergedVariables = { ...variables, ...formEntries }
              
              // Log for debugging
              console.log("[MedusaProvider QueryClient] Intercepted blog article save mutation")
              console.log("[MedusaProvider QueryClient] Original variables:", variables)
              console.log("[MedusaProvider QueryClient] Form entries:", formEntries)
              console.log("[MedusaProvider QueryClient] Merged variables:", mergedVariables)

              // Call the original mutation with merged variables
              const result = await originalMutationFn(mergedVariables, ...args.slice(1))
              return result
            }
          }
          
          // Handle upload mutations (transform response)
          const result = await originalMutationFn(...args)
          
          // Check if this is an upload mutation (first arg is a File)
          if (variables instanceof File) {
            // Transform { files: [...] } to { uploads: [...] }
            if (result && typeof result === 'object' && 'files' in result && !('uploads' in result)) {
              console.log("[MedusaProvider QueryClient] Transforming upload mutation result:", result)
              const transformed = { uploads: result.files }
              console.log("[MedusaProvider QueryClient] Transformed to:", transformed)
              return transformed
            }
          }
          
          return result
        }
      }
      
      return originalBuild(queryClient, options, state)
    }
  }
  
  return queryClientInstance
}

// Get the singleton QueryClient instance
const queryClient = getQueryClient()

// Import medusa-react's MedusaProvider directly
import { MedusaProvider as MedusaReactProvider } from "medusa-react"

// Create the MedusaProvider component that wraps medusa-react's provider
export const MedusaProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Get the base URL - use window.location.origin for admin panel
  const baseUrl = import.meta.env.VITE_BACKEND_URL || 
                  (typeof window !== "undefined" ? window.location.origin : "/")
  
  return (
    <MedusaReactProvider
      baseUrl={baseUrl}
      queryClientProviderProps={{
        client: queryClient,
      }}
      // Ensure credentials are included for session-based auth
      // medusa-react should handle this automatically, but we'll be explicit
    >
      {children}
    </MedusaReactProvider>
  )
}

// Also export SDK for compatibility hooks
export const sdk = new Medusa({
  baseUrl: import.meta.env.VITE_BACKEND_URL || 
            (typeof window !== "undefined" ? window.location.origin : "/"),
  debug: import.meta.env.DEV,
  auth: {
    type: "session",
  },
})

// Patch the SDK's upload.create method to return { uploads: [...] } instead of { files: [...] }
// This ensures medusa-react's useAdminUploadFile returns the format the plugin expects
if (typeof window !== "undefined" && sdk.admin?.upload?.create) {
  const originalCreate = sdk.admin.upload.create.bind(sdk.admin.upload)
  sdk.admin.upload.create = async (options: any) => {
    const response = await originalCreate(options)
    console.log("[SDK Patch] Original upload response:", response)
    
    // Transform { files: [...] } to { uploads: [...] }
    if (response && typeof response === 'object' && 'files' in response && !('uploads' in response)) {
      const transformed = { uploads: response.files }
      console.log("[SDK Patch] Transformed upload response:", transformed)
      return transformed
    }
    
    return response
  }
  console.log("[SDK Patch] Patched sdk.admin.upload.create")
}

// Patch the SDK client's fetch method to ensure empty values are sent
// This fixes the issue where the plugin filters out empty form field values
if (typeof window !== "undefined" && sdk.client?.fetch) {
  const originalFetch = sdk.client.fetch.bind(sdk.client)
  sdk.client.fetch = async function(path: string, options: any = {}) {
    // Only intercept requests to blog articles API
    if (path.includes('/admin/blog/articles') && options?.method && ['POST', 'PUT', 'PATCH'].includes(options.method.toUpperCase())) {
      if (options.body) {
        try {
          // Parse the body if it's a string
          let bodyData: any = {}
          if (typeof options.body === 'string') {
            try {
              bodyData = JSON.parse(options.body)
            } catch (e) {
              // If parsing fails, proceed with original request
              return originalFetch(path, options)
            }
          } else {
            bodyData = options.body || {}
          }

          // Get all form fields directly from the DOM
          // This ensures we capture empty values even if the plugin filters them out
          const form = document.querySelector('form') || document
          const formEntries: Record<string, any> = {}
          
          // Field name mapping (plugin uses kebab-case, API expects snake_case)
          const fieldMap: Record<string, string> = {
            'seo-title': 'seo_title',
            'seo-keywords': 'seo_keywords',
            'seo-description': 'seo_description',
            'url-slug': 'url_slug',
          }

          // Get all input, textarea, and select elements
          const inputs = form.querySelectorAll('input, textarea, select')
          inputs.forEach((input: any) => {
            const name = input.name || input.id
            if (name) {
              // Map field names
              const mappedName = fieldMap[name] || name.replace(/-/g, '_')
              
              // Get the current value
              let value: any = input.value
              
              // Handle empty values - explicitly set to empty string
              if (value === '' || value === null || value === undefined) {
                formEntries[mappedName] = ''
              } else {
                formEntries[mappedName] = value
              }
            }
          })

          // Also check for specific fields mentioned by the user
          const specificFields = ['author', 'seo_title', 'seo_keywords', 'seo_description', 'url_slug', 'subtitle']
          specificFields.forEach(fieldName => {
            // Try different selectors
            const selectors = [
              `[name="${fieldName}"]`,
              `[id="${fieldName}"]`,
              `[name="${fieldName.replace(/_/g, '-')}"]`,
              `[id="${fieldName.replace(/_/g, '-')}"]`,
            ]
            
            for (const selector of selectors) {
              const input = form.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement
              if (input) {
                const value = input.value
                if (value === '' || value === null || value === undefined) {
                  formEntries[fieldName] = ''
                } else {
                  formEntries[fieldName] = value
                }
                break
              }
            }
          })

          // Handle tags field specially (it's a Tagify component)
          const tagsInput = form.querySelector('[name="tags"], [id="tags"]') as HTMLInputElement
          if (tagsInput) {
            // Tagify stores data in a data attribute or as a JSON string
            const tagifyInstance = (tagsInput as any).tagify
            if (tagifyInstance) {
              const tags = tagifyInstance.value || []
              formEntries.tags = Array.isArray(tags) ? tags : []
            } else {
              // Fallback: try to parse from input value
              try {
                const tags = JSON.parse(tagsInput.value || '[]')
                formEntries.tags = Array.isArray(tags) ? tags : []
              } catch {
                formEntries.tags = []
              }
            }
          }

          // Merge form data with existing body data
          // Form data takes precedence to ensure empty values are included
          const mergedData = { ...bodyData, ...formEntries }
          
          // Log for debugging
          console.log("[SDK Patch] Intercepted blog article save request")
          console.log("[SDK Patch] Path:", path)
          console.log("[SDK Patch] Original body:", bodyData)
          console.log("[SDK Patch] Form entries:", formEntries)
          console.log("[SDK Patch] Merged data:", mergedData)

          // Update the body with merged data
          options.body = JSON.stringify(mergedData)
          options.headers = {
            ...options.headers,
            'Content-Type': 'application/json',
          }
        } catch (e) {
          console.error("[SDK Patch] Error intercepting fetch for empty values:", e)
        }
      }
    }
    
    return originalFetch(path, options)
  }
  console.log("[SDK Patch] Patched sdk.client.fetch to include empty values")
}

