import { useEffect } from 'react'
import { toast } from 'sonner'

export function ToastError({ error }: { error: string }) {
  useEffect(() => {
    if (error) toast.error(error)
  }, [error])
  return null
}
