import { input, password, confirm, select } from '@inquirer/prompts'

export interface PromptAdapter {
  input(message: string, defaultValue?: string): Promise<string>
  password(message: string): Promise<string>
  confirm(message: string): Promise<boolean>
  select(message: string, choices: string[]): Promise<string>
}

export function createPromptAdapter(): PromptAdapter {
  return {
    input: (message, defaultValue) =>
      input({ message, ...(defaultValue !== undefined ? { default: defaultValue } : {}) }),

    password: (message) =>
      password({ message, mask: '•' }),

    confirm: (message) =>
      confirm({ message }),

    select: (message, choices) =>
      select({
        message,
        choices: choices.map((c) => ({ value: c, name: c })),
      }),
  }
}
