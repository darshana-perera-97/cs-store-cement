import { useLocation } from 'react-router-dom';

function Footer() {
  const year = new Date().getFullYear();
  const { pathname } = useLocation();
  const dashboard = pathname.startsWith('/dashboard');

  return (
    <footer
      className={`shrink-0 border-t border-slate-200/80 bg-white/80 py-3 text-center text-[11px] font-medium text-slate-500 backdrop-blur-sm sm:text-xs ${
        dashboard
          ? 'md:pl-[260px] lg:pr-[300px] xl:pr-[320px]'
          : ''
      }`}
      role="contentinfo"
    >
      <p className="px-4">
        © {year} CS Store — Cement supply. All rights reserved.
      </p>
    </footer>
  );
}

export default Footer;
