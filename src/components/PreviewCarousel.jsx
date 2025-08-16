import { useState } from 'react';
import './PreviewCarousel.css';
import { issues } from '../data/issues';
import InfoPanel from './InfoPanel';

const PreviewCarousel = () => {
  const [selectedIssue, setSelectedIssue] = useState(null);

  return (
    <section className="preview-carousel">
      <div className="preview-list">
        {issues.map((issue) => (
          <div
            key={issue.id}
            className="preview-card"
            onClick={() => setSelectedIssue(issue)}
          >
            <img
              src={issue.preview}
              alt={`${issue.title} preview`}
              className="preview-image"
            />
            <h3>{issue.title}</h3>
          </div>
        ))}
      </div>
      {selectedIssue && (
        <InfoPanel issue={selectedIssue} onClose={() => setSelectedIssue(null)} />
      )}
    </section>
  );
};

export default PreviewCarousel;
