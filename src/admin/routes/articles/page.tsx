import { defineRouteConfig } from "@medusajs/admin-sdk"
import { DocumentSeries } from "@medusajs/icons"
import React, { useEffect, useState, useMemo } from "react"
import { useNavigate } from "react-router-dom"
import { sdk } from "../../../lib/compat-provider"
import { 
  DataTable, 
  Heading, 
  Button, 
  DropdownMenu,
  useDataTable,
  createDataTableColumnHelper,
} from "@medusajs/ui"
import { PencilSquare, Trash, Plus, EllipsisHorizontal } from "@medusajs/icons"

type Article = {
  id: string
  title: string
  subtitle: string | null
  author: string
  url_slug: string
  draft: boolean
  created_at: string
  updated_at: string
  thumbnail_image: string | null
  tags: string[]
}

const columnHelper = createDataTableColumnHelper<Article>()

const ArticlePage = () => {
  const navigate = useNavigate()
  const [search, setSearch] = useState("")
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: 20,
  })

  const offset = useMemo(() => pagination.pageIndex * pagination.pageSize, [pagination])
  const [articles, setArticles] = useState<Article[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Build query params
  const queryParams = useMemo(() => {
    const params = new URLSearchParams()
    params.append("skip", offset.toString())
    params.append("take", pagination.pageSize.toString())
    if (search) {
      params.append("where", JSON.stringify({ title: { $ilike: `%${search}%` } }))
    }
    return params.toString()
  }, [offset, pagination.pageSize, search])

  // Fetch articles using SDK directly
  useEffect(() => {
    let cancelled = false
    
    const fetchArticles = async () => {
      setIsLoading(true)
      setError(null)
      
      try {
        console.log("[ArticlePage] Fetching articles with params:", queryParams)
        const url = `/admin/blog/articles?${queryParams}`
        console.log("[ArticlePage] Full URL:", url)
        
        const response = await sdk.client.fetch<{ articles: Article[]; count: number; sanitized_query: any }>(
          url,
          {
            method: "GET",
            credentials: "include",
          }
        )
        
        console.log("[ArticlePage] Raw response:", response)
        console.log("[ArticlePage] Response type:", typeof response)
        console.log("[ArticlePage] Response received:", {
          articlesCount: response?.articles?.length || 0,
          count: response?.count || 0,
          hasArticles: !!response?.articles,
          responseKeys: response ? Object.keys(response) : [],
          responseString: JSON.stringify(response).substring(0, 500),
        })
        
        // Handle both direct response and wrapped response
        const articles = response?.articles || (response as any)?.data?.articles || []
        const count = response?.count || (response as any)?.data?.count || 0
        
        console.log("[ArticlePage] Extracted articles:", articles.length, "count:", count)
        
        if (!cancelled) {
          setArticles(articles)
          setTotalCount(count)
          setIsLoading(false)
        }
      } catch (err: any) {
        if (!cancelled) {
          console.error("[ArticlePage] Error fetching articles:", err)
          console.error("[ArticlePage] Error details:", {
            message: err?.message,
            stack: err?.stack,
            response: err?.response,
          })
          setError(err?.message || "Failed to fetch articles")
          setIsLoading(false)
        }
      }
    }
    
    fetchArticles()
    
    return () => {
      cancelled = true
    }
  }, [queryParams])

  const columns = [
    columnHelper.accessor("title", {
      header: "Article",
      enableSorting: false,
      cell: ({ row }) => {
        const article = row.original
        return (
          <div className="flex h-full w-full max-w-[250px] items-center gap-x-3 overflow-hidden">
            {article.thumbnail_image && (
              <div className="w-fit flex-shrink-0">
                <div className="bg-ui-bg-component border-ui-border-base flex items-center justify-center overflow-hidden rounded border h-8 w-8">
                  <img
                    src={article.thumbnail_image}
                    alt={article.title}
                    className="h-full w-full object-cover object-center"
                  />
                </div>
              </div>
            )}
            <span title={article.title} className="truncate">
              {article.title}
            </span>
          </div>
        )
      },
    }),
    columnHelper.accessor("author", {
      header: "Author",
      enableSorting: false,
      cell: ({ row }) => {
        const article = row.original
        return (
          <div className="flex h-full w-full items-center">
            <span className="truncate">{article.author || "-"}</span>
          </div>
        )
      },
    }),
    columnHelper.accessor("draft", {
      header: "Status",
      enableSorting: false,
      cell: ({ row }) => {
        const article = row.original
        return (
          <div className="txt-compact-small text-ui-fg-subtle flex h-full w-full items-center gap-x-2 overflow-hidden">
            <div
              role="presentation"
              className="flex h-5 w-2 items-center justify-center"
            >
              <div
                className={`h-2 w-2 rounded-sm shadow-[0px_0px_0px_1px_rgba(0,0,0,0.12)_inset] ${
                  article.draft ? "bg-ui-tag-orange-icon" : "bg-ui-tag-green-icon"
                }`}
              ></div>
            </div>
            <span className="truncate">{article.draft ? "Draft" : "Published"}</span>
          </div>
        )
      },
    }),
    columnHelper.accessor("tags", {
      header: "Tags",
      enableSorting: false,
      cell: ({ row }) => {
        const article = row.original
        const tags = Array.isArray(article.tags) ? article.tags : []
        return (
          <div className="flex h-full w-full items-center overflow-hidden max-w-[250px]">
            {tags.length > 0 ? (
              <span title={tags.join(", ")} className="truncate">
                {tags.slice(0, 2).join(", ")}
                {tags.length > 2 && ` +${tags.length - 2}`}
              </span>
            ) : (
              <span className="text-ui-fg-muted">-</span>
            )}
          </div>
        )
      },
    }),
    columnHelper.accessor("updated_at", {
      header: "Updated",
      enableSorting: false,
      cell: ({ row }) => {
        const article = row.original
        const date = new Date(article.updated_at)
        return (
          <div className="flex h-full w-full items-center">
            <span className="truncate">
              {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
        )
      },
    }),
    columnHelper.display({
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const article = row.original
        return (
          <div className="flex size-full items-center justify-end">
            <DropdownMenu>
              <DropdownMenu.Trigger asChild>
                <button
                  type="button"
                  className="transition-fg inline-flex items-center justify-center overflow-hidden rounded-md outline-none disabled:bg-ui-bg-disabled disabled:shadow-buttons-neutral disabled:text-ui-fg-disabled text-ui-fg-subtle bg-ui-button-transparent hover:bg-ui-button-transparent-hover active:bg-ui-button-transparent-pressed focus-visible:shadow-buttons-neutral-focus focus-visible:bg-ui-bg-base disabled:!bg-transparent disabled:!shadow-none h-7 w-7 p-1"
                >
                  <EllipsisHorizontal />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content>
                <DropdownMenu.Item
                  onClick={() => navigate(`../a/article-editor?id=${article.id}`)}
                  className="gap-x-2"
                >
                  <PencilSquare className="text-ui-fg-subtle" />
                  Edit
                </DropdownMenu.Item>
                <DropdownMenu.Separator />
                <DropdownMenu.Item
                  className="text-ui-fg-error gap-x-2"
                  onClick={async () => {
                    if (confirm(`Are you sure you want to delete "${article.title}"?`)) {
                      try {
                        const response = await fetch(`/admin/blog/articles/${article.id}`, {
                          method: "DELETE",
                          credentials: "include",
                        })
                        if (response.ok) {
                          window.location.reload()
                        }
                      } catch (err) {
                        console.error("Error deleting article:", err)
                      }
                    }
                  }}
                >
                  <Trash className="text-ui-fg-error" />
                  Delete
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu>
          </div>
        )
      },
    }),
  ]

  // Debug: Log articles before creating table
  useEffect(() => {
    console.log("[ArticlePage] Articles state updated:", {
      articlesCount: articles.length,
      totalCount,
      isLoading,
      articles: articles.map(a => ({ id: a.id, title: a.title })),
    })
  }, [articles, totalCount, isLoading])

  const table = useDataTable({
    columns,
    data: articles,
    getRowId: (row) => row.id,
    rowCount: totalCount,
    isLoading,
    pagination: {
      state: pagination,
      onPaginationChange: setPagination,
    },
    search: {
      state: search,
      onSearchChange: setSearch,
    },
    onRowClick: (event, row) => {
      navigate(`../a/article-editor?id=${row.id}`)
    },
  })

  // Debug: Log table instance and data
  useEffect(() => {
    console.log("[ArticlePage] Table debug:", {
      hasTable: !!table,
      articlesLength: articles.length,
      tableData: table?.getRowModel?.()?.rows?.length || 'N/A',
      tableState: table?.getState?.() || 'N/A',
    })
  }, [table, articles])

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-red-500">{error}</p>
      </div>
    )
  }

  return (
    <div className="flex h-screen w-full flex-col overflow-auto">
        <main className="flex h-full w-full flex-col items-center overflow-y-auto transition-opacity delay-200 duration-200">
          <div className="flex w-full max-w-[1600px] flex-col gap-y-2 p-3">
            <div className="flex flex-col gap-y-3">
              <div className="shadow-elevation-card-rest bg-ui-bg-base w-full rounded-lg divide-y p-0">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4">
                  <Heading level="h1">Articles</Heading>
                  <div className="flex items-center justify-center gap-x-2">
                    <Button
                      variant="secondary"
                      size="small"
                      onClick={() => navigate("../a/article-editor")}
                    >
                      <Plus />
                      Create
                    </Button>
                  </div>
                </div>

                {/* Table */}
                <div className="divide-y">
                  <div className="flex w-full flex-col overflow-hidden">
                    {isLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <p className="text-ui-fg-subtle">Loading articles...</p>
                      </div>
                    ) : articles.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-16">
                        <p className="text-ui-fg-subtle mb-4">No articles found</p>
                        <Button
                          variant="secondary"
                          size="small"
                          onClick={() => navigate("../a/article-editor")}
                        >
                          <Plus />
                          Create your first article
                        </Button>
                      </div>
                    ) : (
                      <div className="w-full overflow-x-auto">
                        <DataTable instance={table}>
                          <DataTable.Toolbar className="flex items-center justify-end">
                            <DataTable.Search />
                          </DataTable.Toolbar>
                          <DataTable.Table />
                        </DataTable>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
  )
}

export const config = defineRouteConfig({
  label: "Articles",
  icon: DocumentSeries,
})

export default ArticlePage
