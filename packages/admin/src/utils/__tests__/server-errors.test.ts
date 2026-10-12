import { describe, it, expect } from 'vitest'
import { splitServerDetails } from '../server-errors'

describe('splitServerDetails', () => {
  it('puts a detail on its field when the form has one, and lists the rest', () => {
    // MUTATION: send every detail to mergeServerErrors. A path inside a
    // paragraph item ("cards[0].heading") then matches no field, and its
    // message is never shown: the editor sees only "Some values are not valid".
    const result = splitServerDetails(
      [
        { field: 'title', message: 'title can be at most 255 characters.' },
        { field: 'cards[0].heading', message: 'cards[0].heading can be at most 255 characters.' },
      ],
      ['title', 'cards']
    )
    expect(result.fieldErrors).toEqual([{ field: 'title', message: 'title can be at most 255 characters.' }])
    expect(result.other).toEqual(['cards[0].heading can be at most 255 characters.'])
  })
})
