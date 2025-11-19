import React, { createContext, useContext } from "react"
import { useQuery, useMutation, UseQueryOptions, UseMutationOptions, QueryKey } from "@tanstack/react-query"
import { sdk } from "./compat-provider"
import { FetchError } from "@medusajs/js-sdk"

// Create a context that provides the SDK
const MedusaContext = createContext<{ sdk: typeof sdk } | null>(null)

export const useMedusa = () => {
  const context = useContext(MedusaContext)
  if (!context) {
    throw new Error("useMedusa must be used within a MedusaProvider")
  }
  return context
}

// Compatibility hooks for medusa-react
export const useAdminCustomQuery = <T = any>(
  path: string,
  queryKey?: QueryKey,
  options?: UseQueryOptions<T, FetchError, T, QueryKey>
) => {
  return useQuery<T, FetchError>({
    queryKey: queryKey || [path],
    queryFn: async () => {
      const response = await sdk.client.fetch<T>(path, {
        method: "get",
        credentials: "include",
      })
      return response
    },
    ...options,
  })
}

export const useAdminCustomPost = <T = any>(
  path: string,
  queryKey?: QueryKey,
  options?: UseMutationOptions<T, FetchError, any>
) => {
  return useMutation<T, FetchError, any>({
    mutationFn: async (data: any) => {
      const response = await sdk.client.fetch<T>(path, {
        method: "post",
        body: JSON.stringify(data),
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
      })
      return response
    },
    ...options,
  })
}

export const useAdminCustomDelete = <T = any>(
  path: string,
  queryKey?: QueryKey,
  options?: UseMutationOptions<T, FetchError, any>
) => {
  return useMutation<T, FetchError, any>({
    mutationFn: async (data?: any) => {
      const response = await sdk.client.fetch<T>(path, {
        method: "delete",
        body: data ? JSON.stringify(data) : undefined,
        headers: data ? {
          "Content-Type": "application/json",
        } : undefined,
        credentials: "include",
      })
      return response
    },
    ...options,
  })
}

export const useAdminUploadFile = (options?: UseMutationOptions<any, FetchError, File>) => {
  return useMutation<any, FetchError, File>({
    mutationFn: async (file: File) => {
      try {
        console.log("Uploading file:", file.name, file.type, file.size)
        
        // Use the SDK's upload method which handles FormData correctly
        const response = await sdk.admin.upload.create({
          files: [file],
        })
        
        console.log("Upload response:", response)
        
        // The response is { files: [...] }
        // The plugin's onSuccess handler expects { uploads: [...] } format
        // It destructures { uploads } and then accesses uploads[0].url
        if (response && response.files && Array.isArray(response.files) && response.files.length > 0) {
          const result = { uploads: response.files }
          console.log("Returning upload result:", result)
          return result
        }
        
        // If response structure is different, return empty array as fallback
        console.warn("Unexpected upload response format:", response)
        return { uploads: [] }
      } catch (error) {
        console.error("File upload error:", error)
        throw error
      }
    },
    ...options,
  })
}

export const useAdminDeleteFile = (options?: UseMutationOptions<any, FetchError, { file_key: string }>) => {
  return useMutation<any, FetchError, { file_key: string }>({
    mutationFn: async ({ file_key }: { file_key: string }) => {
      const response = await sdk.client.fetch(`/admin/uploads/${file_key}`, {
        method: "delete",
        credentials: "include",
      })
      return response
    },
    ...options,
  })
}

