export default function Hero({ search, onSearchChange, classCount, trainerCount }) {
  return (
    <section className="hero">
      <div className="hero-content">
        <h1>Book your next class in seconds</h1>
        <p>
          Browse classes and the trainers who teach them, pick a time that works, and pay
          securely — all in one place.
        </p>
        <div className="hero-search">
          <input
            type="search"
            placeholder="Search classes by name or description…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="search-input"
            aria-label="Search classes"
          />
        </div>
        {(classCount != null || trainerCount != null) && (
          <div className="hero-stats">
            {classCount != null && (
              <div className="hero-stat">
                <strong>{classCount}</strong>
                <span>Classes</span>
              </div>
            )}
            {trainerCount != null && (
              <div className="hero-stat">
                <strong>{trainerCount}</strong>
                <span>Trainers</span>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
