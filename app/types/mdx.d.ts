declare module "*.mdx" {
  import type { ComponentType } from "react";

  export const frontmatter: Record<string, unknown>;
  const Component: ComponentType<{
    components?: Record<string, ComponentType<unknown>>;
  }>;
  export default Component;
}
