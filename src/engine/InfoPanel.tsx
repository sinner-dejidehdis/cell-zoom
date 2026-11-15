import { useState } from 'react';
import { LEVELS, type LevelId } from '../content/levels';
import { levelText, ui } from '../i18n';

export function InfoPanel({ level }: { level: LevelId }) {
  const t = levelText(LEVELS[level].textKey);
  const [open, setOpen] = useState(true);
  return (
    <aside className={open ? 'panel' : 'panel closed'}>
      <button className="panel-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? '›' : '‹'}
      </button>
      {open && (
        <div className="panel-body">
          <h2>{t.name}</h2>
          <section>
            <h3>{ui.panel.what}</h3>
            <p>{t.what}</p>
          </section>
          <section>
            <h3>{ui.panel.doing}</h3>
            <p>{t.doing}</p>
          </section>
          <section>
            <h3>{ui.panel.rules}</h3>
            <p>{t.rules}</p>
          </section>
          <section className="simplified">
            <h3>{ui.panel.simplified}</h3>
            <ul>
              {t.simplified.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </section>
          {t.sources.length > 0 && (
            <section>
              <h3>{ui.panel.sources}</h3>
              <ul>
                {t.sources.map((s) => (
                  <li key={s.url + s.label}>
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.label}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </aside>
  );
}
