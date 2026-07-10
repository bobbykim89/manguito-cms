import { input, select } from '@inquirer/prompts'

export interface PromptAdapter {
  input(message: string, defaultValue?: string): Promise<string>
  select(message: string, choices: string[]): Promise<string>
}

export function createPromptAdapter(): PromptAdapter {
  return {
    input: (message, defaultValue) =>
      input({ message, ...(defaultValue !== undefined ? { default: defaultValue } : {}) }),

    select: (message, choices) =>
      select({
        message,
        choices: choices.map((c) => ({ value: c, name: c })),
      }),
  }
}
