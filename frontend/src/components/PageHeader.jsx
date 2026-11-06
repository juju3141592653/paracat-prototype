export function PageHeader({crumbs, title, tags, meta}) {
  return (
    <header className="page-head">
      <div>
        {crumbs && <div className="crumbs">{crumbs}</div>}
        <div className="page-title"><h1>{title}</h1>{tags}</div>
      </div>
      {meta && <div className="page-meta">{meta}</div>}
    </header>
  );
}
