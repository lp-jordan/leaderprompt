import './InfoPanel.css';

const InfoPanel = ({ issue, onClose }) => {
  if (!issue) return null;
  return (
    <div className="info-panel">
      <button className="info-close" onClick={onClose} aria-label="Close">
        &times;
      </button>
      <img src={issue.cover} alt={`${issue.title} cover`} className="info-cover" />
      <div className="info-details">
        <h2>{issue.title}</h2>
        {issue.subtitle && <h4>{issue.subtitle}</h4>}
        <p>{issue.description}</p>
        <ul className="info-credits">
          <li>
            <strong>Writer:</strong> {issue.credits.writer}
          </li>
          <li>
            <strong>Artist:</strong> {issue.credits.artist}
          </li>
          <li>
            <strong>Letterer:</strong> {issue.credits.letterer}
          </li>
        </ul>
        <a
          href={issue.readerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="info-button"
        >
          Read this issue
        </a>
      </div>
    </div>
  );
};

export default InfoPanel;
