import { ref } from 'vue'
import type { ParsedField } from '@bobbykim/manguito-cms-core'

export function useFormValidation() {
  const errors = ref<Record<string, string>>({})
  const touched = ref<Set<string>>(new Set())

  function touch(field: string) {
    touched.value.add(field)
  }

  function setError(field: string, message: string) {
    errors.value[field] = message
  }

  function clearErrors() {
    errors.value = {}
    touched.value = new Set()
  }

  function mergeServerErrors(details: Array<{ field: string; message: string }>) {
    for (const { field, message } of details) {
      errors.value[field] = message
    }
  }

  function validate(
    fields: ParsedField[],
    values: Record<string, unknown>,
    validateAll = false
  ): boolean {
    // When validating for publish, mark all fields touched so errors persist
    // for subsequent interactions — no disappearing errors after a publish attempt.
    if (validateAll) {
      for (const field of fields) {
        touched.value.add(field.name)
      }
    }

    let allValid = true

    for (const field of fields) {
      const value = values[field.name]
      const errorMessage = checkField(field, value)

      if (errorMessage) {
        allValid = false
        if (touched.value.has(field.name)) {
          errors.value[field.name] = errorMessage
        }
      } else {
        delete errors.value[field.name]
      }
    }

    return allValid
  }

  function checkField(field: ParsedField, value: unknown): string | null {
    const { required, pattern, min, max, max_items, allowed_values } = field.validation

    if (required && isEmpty(value)) {
      return `${field.label} is required.`
    }

    if (isEmpty(value)) return null

    if (pattern && typeof value === 'string' && !new RegExp(pattern).test(value)) {
      return `${field.label} is not in the correct format.`
    }

    if (typeof value === 'number') {
      if (min !== undefined && value < min) {
        return `${field.label} must be at least ${min}.`
      }
      if (max !== undefined && value > max) {
        return `${field.label} must be at most ${max}.`
      }
    }

    if (allowed_values && allowed_values.length > 0 && typeof value === 'string') {
      if (!allowed_values.includes(value)) {
        return `${field.label} must be one of: ${allowed_values.join(', ')}.`
      }
    }

    if (max_items !== undefined && Array.isArray(value) && value.length > max_items) {
      return `${field.label} can have at most ${max_items} items.`
    }

    return null
  }

  function isEmpty(value: unknown): boolean {
    return value === null || value === undefined || value === ''
  }

  return {
    errors,
    touched,
    touch,
    setError,
    clearErrors,
    mergeServerErrors,
    validate,
  }
}
