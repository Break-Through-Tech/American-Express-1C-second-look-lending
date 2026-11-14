import { useSearchParams } from 'react-router-dom'
import RawDataTab from './insights/RawDataTab.jsx'
import ModelTab from './insights/ModelTab.jsx'

export default function Insights() {
  // Keep the tab in the URL so it survives a refresh and can be shared
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') === 'model' ? 'model' : 'raw'

  return (
    <>
      <div className="page-head">
        <h1>Insights: data & model</h1>
        <p>
          A guided tour for anyone new to the project. <strong>Raw data</strong> shows what the eight tables look like and
          how they become one row per loan. <strong>Model</strong> walks through how a trained model was built, what it
          learned and what its decisions mean in dollars.
        </p>
      </div>
      <div className="tabs" style={{ marginBottom: 16 }}>
        <button className={tab === 'raw' ? 'active' : ''} onClick={() => setSearchParams({})}>Raw data</button>
        <button className={tab === 'model' ? 'active' : ''} onClick={() => setSearchParams({ tab: 'model' })}>Model</button>
      </div>
      {tab === 'raw' ? <RawDataTab /> : <ModelTab />}
    </>
  )
}
