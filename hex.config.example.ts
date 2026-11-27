import { defineHexConfig } from '@hex/commands'
import { ampRewrite } from './amp-rewrite.ts'

export default defineHexConfig({
  transformations: {
    'amp-rewrite': ampRewrite,
  },
})
