import { ref } from 'vue'
import { defineStore } from 'pinia'

export type UserResponse = {
  id: string
  email: string
  role: string
  must_change_password: boolean
  created_at: string
  updated_at: string
}

export const useUsersStore = defineStore('users', () => {
  const users = ref<UserResponse[]>([])
  const loading = ref(false)

  function setUsers(newUsers: UserResponse[]) {
    users.value = newUsers
  }

  function setUser(user: UserResponse) {
    const index = users.value.findIndex(u => u.id === user.id)
    if (index !== -1) {
      users.value[index] = user
    } else {
      users.value.push(user)
    }
  }

  function removeUser(id: string) {
    const index = users.value.findIndex(u => u.id === id)
    if (index !== -1) {
      users.value.splice(index, 1)
    }
  }

  return {
    users,
    loading,
    setUsers,
    setUser,
    removeUser,
  }
})
