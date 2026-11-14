import { Link } from 'react-router-dom'
import Icon from '../components/Icon.jsx'

const ROLES = [
  {
    to: '/apply',
    icon: 'user',
    tag: 'For applicants',
    title: 'Apply for a loan',
    text: 'Fill in a step-by-step application and get a decision straight away, with the reasons in plain language.',
    cta: 'Start an application',
    color: 'var(--series-thin)',
  },
  {
    to: '/business/pipeline',
    icon: 'briefcase',
    tag: 'For the business',
    title: 'Run the lending policy',
    text: 'Work through the queue of applications and borderline cases, track profit and fairness, and publish policy changes.',
    cta: 'Open the work queue',
    color: 'var(--series-established)',
  },
  {
    to: '/tech',
    icon: 'code',
    tag: 'For the tech team',
    title: 'Build and ship models',
    text: 'Explore the data, train and compare models live, and choose the primary and second-look models.',
    cta: 'Open the tech workspace',
    color: 'var(--accent)',
  },
]

export default function Home() {
  return (
    <>
      <div className="home-hero">
        <span className="eyebrow"><Icon name="shield" size={14} />Fair, explainable lending</span>
        <h1>Lending decisions that make money and give newcomers a fair second look</h1>
        <p>
          A model estimates each applicant's chance of default. A lending policy turns that into approve or deny, and makes
          sure people with little credit history are not turned away just for being new. Pick your workspace:
        </p>
      </div>

      <div className="role-grid">
        {ROLES.map((role) => (
          <Link key={role.to} to={role.to} className="role-card" style={{ '--role': role.color }}>
            <span className="role-icon"><Icon name={role.icon} size={20} /></span>
            <span className="role-tag">{role.tag}</span>
            <h2>{role.title}</h2>
            <p>{role.text}</p>
            <span className="role-cta">{role.cta}<Icon name="arrow" size={16} /></span>
          </Link>
        ))}
      </div>

      <div className="card connect">
        <h2>How the workspaces connect</h2>
        <div className="connect-flow">
          <div><strong>Tech team</strong><span>trains models, picks the primary and second-look models</span></div>
          <span className="connect-arrow" aria-hidden="true">→</span>
          <div><strong>Business</strong><span>runs the pipeline and reviews borderline cases</span></div>
          <span className="connect-arrow" aria-hidden="true">→</span>
          <div><strong>Applicants</strong><span>get decisions from that model and policy</span></div>
        </div>
        <p className="small muted" style={{ marginTop: 12 }}>
          New here? Start with <Link to="/help">Help</Link> for the project overview and how-to guides.
        </p>
      </div>
    </>
  )
}
