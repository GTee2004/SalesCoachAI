import { z } from 'zod'

export const NAME_MAX_LENGTH = 100
export const USERNAME_MIN_LENGTH = 3
export const USERNAME_MAX_LENGTH = 30
export const USERNAME_CODE_LENGTH = 6

// Same rule as Better Auth's username plugin, which signup relies on.
const USERNAME_PATTERN = /^[a-zA-Z0-9_.]+$/

export const nameSchema = z
  .string()
  .trim()
  .min(1, 'Vui lòng nhập tên.')
  .max(NAME_MAX_LENGTH, `Tên tối đa ${NAME_MAX_LENGTH} ký tự.`)

export const usernameSchema = z
  .string()
  .trim()
  .min(USERNAME_MIN_LENGTH, `Bí danh cần ít nhất ${USERNAME_MIN_LENGTH} ký tự.`)
  .max(USERNAME_MAX_LENGTH, `Bí danh tối đa ${USERNAME_MAX_LENGTH} ký tự.`)
  .regex(
    USERNAME_PATTERN,
    'Bí danh chỉ gồm chữ cái, số, dấu gạch dưới và dấu chấm.',
  )

export const usernameCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, `Mã xác minh gồm ${USERNAME_CODE_LENGTH} chữ số.`)

// Usernames are stored lower-case, as the username plugin does.
export const normalizeUsername = (username: string) =>
  username.trim().toLowerCase()
