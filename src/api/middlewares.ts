import { MiddlewaresConfig } from "@medusajs/framework/http"

export const config: MiddlewaresConfig = {
  routes: [
    {
        matcher: "/admin/blog/articles/*", // accept larger bodies for articles
        bodyParser: { sizeLimit: 10000000 }, // in bytes
    },
  ],
}