import { Link } from 'react-router-dom'
import { PageHeader } from '../components/common'
import { ROUTES } from '../utils/constants'

const NotFound = () => (
  <>
    <PageHeader
      title="404 — Page not found"
      description="The page you requested does not exist."
    />
    <Link to={ROUTES.HOME}>Back to home</Link>
  </>
)

export default NotFound
