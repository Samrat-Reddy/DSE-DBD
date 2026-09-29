/**
 * Example service module showing the intended shape: UI components call a
 * named function here and never touch `apiClient` or endpoint strings
 * themselves.
 */

import apiClient from './apiClient'
import { ENDPOINTS } from './endpoints'

export const getApiHealth = () => apiClient.get(ENDPOINTS.health)

export default { getApiHealth }
