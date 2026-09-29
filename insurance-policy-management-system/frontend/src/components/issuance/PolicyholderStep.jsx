import FormField from '../common/FormField'
import './FormSteps.css'

/**
 * Step 2 — policyholder identity and contact details.
 *
 * Field-level errors are supplied by the parent, which owns validation; this
 * component only decides layout.
 */
const PolicyholderStep = ({ values, errors, touched, onChange, onBlur }) => {
  const fieldProps = (name) => ({
    name,
    value: values[name],
    onChange,
    onBlur,
    error: touched[name] ? errors[name] : undefined,
  })

  return (
    <div className="form-step">
      <div className="form-step__group">
        <h3 className="form-step__group-title">Identity</h3>
        <div className="form-grid">
          <FormField
            label="Full name"
            required
            placeholder="As printed on official identification"
            autoComplete="name"
            {...fieldProps('fullName')}
          />
          <FormField
            label="Customer ID"
            hint="Leave blank to generate a new customer ID."
            placeholder="CUS-100241"
            {...fieldProps('customerId')}
          />
          <FormField
            label="Date of birth"
            type="date"
            required
            {...fieldProps('dateOfBirth')}
          />
        </div>
      </div>

      <div className="form-step__group">
        <h3 className="form-step__group-title">Contact</h3>
        <div className="form-grid">
          <FormField
            label="Email address"
            type="email"
            required
            placeholder="name@example.com"
            autoComplete="email"
            {...fieldProps('email')}
          />
          <FormField
            label="Phone number"
            type="tel"
            required
            prefix="+91"
            placeholder="98450 12377"
            autoComplete="tel"
            {...fieldProps('phone')}
          />
        </div>
      </div>

      <div className="form-step__group">
        <h3 className="form-step__group-title">Address</h3>
        <div className="form-grid">
          <FormField
            label="Address line 1"
            required
            placeholder="Flat, building, street"
            autoComplete="address-line1"
            wrapperClassName="form-grid__span"
            {...fieldProps('addressLine1')}
          />
          <FormField
            label="Address line 2"
            placeholder="Area or landmark (optional)"
            autoComplete="address-line2"
            {...fieldProps('addressLine2')}
          />
          <FormField
            label="City"
            required
            autoComplete="address-level2"
            {...fieldProps('city')}
          />
          <FormField
            label="State"
            required
            autoComplete="address-level1"
            {...fieldProps('state')}
          />
          <FormField
            label="PIN code"
            required
            inputMode="numeric"
            maxLength={6}
            placeholder="560025"
            autoComplete="postal-code"
            {...fieldProps('postalCode')}
          />
        </div>
      </div>
    </div>
  )
}

export default PolicyholderStep
