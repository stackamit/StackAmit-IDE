import { useEffect } from 'react';
import IdeShell from '../components/ide/IdeShell.jsx';
import { APP_NAME } from '../config.js';

/** Full-screen IDE surface. Same component powers web and Electron desktop. */
export default function IdeApp() {
  useEffect(() => {
    const prev = document.title;
    document.title = `${APP_NAME} — Editor`;
    return () => {
      document.title = prev;
    };
  }, []);
  return <IdeShell />;
}
