export function renderTemplate(
  content: string,
  vars: Record<string, string>
): string {
  return content.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`)
}
