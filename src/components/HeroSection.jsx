import './HeroSection.css';
import { issues } from '../data/issues';

const HeroSection = () => {
  const firstIssue = issues[0];
  return (
    <section className="hero-section">
      <img src={firstIssue.cover} alt={firstIssue.title} className="hero-image" />
      <div className="hero-overlay">
        <h1>A slow-burn supernatural mystery set in 1920s Colorado.</h1>
        <p>Start reading. Start unraveling.</p>
        <a
          href={firstIssue.readerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="hero-cta"
        >
          Read Now
        </a>
      </div>
    </section>
  );
};

export default HeroSection;
