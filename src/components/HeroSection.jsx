import { useEffect, useState } from 'react';
import './HeroSection.css';
import { issues } from '../data/issues';
import { supabase } from '../utils/supabaseClient.js';

const PAGE_IDS = { buy: 1, read: 2, meet: 3, connect: 4 };

const HeroSection = ({ pageKey = 'read' }) => {
  const [subtitle, setSubtitle] = useState('');
  const firstIssue = issues[0];

  useEffect(() => {
    const fetchSubtitle = async () => {
      const id = PAGE_IDS[pageKey];
      if (!id) return;
      const { data, error } = await supabase
        .from('page_subtitles')
        .select('subtitle')
        .eq('id', id)
        .single();
      if (!error && data) setSubtitle(data.subtitle);
    };
    fetchSubtitle();
  }, [pageKey]);

  return (
    <section className="hero-section">
      <img src={firstIssue.cover} alt={firstIssue.title} className="hero-image" />
      <div className="hero-overlay">
        <h1>A slow-burn supernatural mystery set in 1920s Colorado.</h1>
        <p>{subtitle}</p>
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
