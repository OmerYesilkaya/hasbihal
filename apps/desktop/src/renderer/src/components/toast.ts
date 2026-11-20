import { toast } from 'sonner';
import { playSound } from '../sound.ts';

/** An error toast, with the error sound (#37); use this rather than `toast.error`. */
export function toastError(message: string): void {
  playSound('error');
  toast.error(message);
}
