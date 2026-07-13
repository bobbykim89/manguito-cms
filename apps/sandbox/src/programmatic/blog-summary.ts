import { programmaticField } from '@bobbykim/manguito-cms-core'

export default programmaticField(
  { schema: 'content--blog_post', field: 'blog_summary', on_list: true },
  (ctx) => `${ctx.get('blog_title')} — ${String(ctx.get('blog_desc') ?? '').slice(0, 60)}`,
)
