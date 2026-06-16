import { useUiStore } from '../stores/ui'

// Codes where the raw API message is not suitable for end users.
// Unmapped codes fall back to result.error.message directly.
const ERROR_MESSAGES: Partial<Record<string, string>> = {
  INTERNAL_ERROR:          'Something went wrong. Please try again.',
  NOT_FOUND:               'The requested item could not be found.',
  STORAGE_ERROR:           'File storage is unavailable. Please try again later.',
  MEDIA_IN_USE:            'This file is still in use and cannot be deleted.',
  INSUFFICIENT_PERMISSION: 'You do not have permission to do that.',
  RATE_LIMITED:            'Too many requests. Please wait before trying again.',
  UNAUTHORIZED:            'Your session has expired. Please log in again.',
  TOKEN_EXPIRED:           'Your session has expired. Please log in again.',
}

export function useNotification() {
  const ui = useUiStore()

  return {
    success: (message: string) => ui.addToast('success', message),
    error: (message: string) => ui.addToast('error', message),
    warning: (message: string) => ui.addToast('warning', message),
    apiError: (code: string, fallback: string) =>
      ui.addToast('error', ERROR_MESSAGES[code] ?? fallback),
  }
}
