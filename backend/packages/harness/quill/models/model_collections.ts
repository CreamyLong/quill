/**
 * Model collections — favorites and recently used models.
 *
 * Tracks user preferences for models across sessions. Persisted to
 * localStorage on the frontend and optionally synced via the backend.
 *
 * Pattern: Model Collections Store (OpenWork).
 */

/** A model reference (minimal identifier). */
export interface ModelRef {
  /** Provider id (e.g. "openai"). */
  provider: string;
  /** Model id within the provider (e.g. "gpt-4"). */
  model: string;
  /** Display name for the model. */
  displayName?: string;
}

/** Collection of user's model preferences. */
export interface ModelCollections {
  /** Starred/favorite models. */
  favorites: ModelRef[];
  /** Recently used models (most recent first). */
  recent: ModelRef[];
  /** Maximum number of recent models to track. */
  maxRecent: number;
}

/** Default collections state. */
export function defaultCollections(maxRecent = 5): ModelCollections {
  return {
    favorites: [],
    recent: [],
    maxRecent,
  };
}

/**
 * Add a model to favorites.
 *
 * If the model is already favorited, this is a no-op.
 * Returns a new collections object (immutable update).
 */
export function addFavorite(
  collections: ModelCollections,
  model: ModelRef,
): ModelCollections {
  const exists = collections.favorites.some(
    (f) => f.provider === model.provider && f.model === model.model,
  );
  if (exists) return collections;
  return {
    ...collections,
    favorites: [...collections.favorites, model],
  };
}

/**
 * Remove a model from favorites.
 */
export function removeFavorite(
  collections: ModelCollections,
  model: ModelRef,
): ModelCollections {
  return {
    ...collections,
    favorites: collections.favorites.filter(
      (f) => !(f.provider === model.provider && f.model === model.model),
    ),
  };
}

/**
 * Check if a model is favorited.
 */
export function isFavorite(collections: ModelCollections, model: ModelRef): boolean {
  return collections.favorites.some(
    (f) => f.provider === model.provider && f.model === model.model,
  );
}

/**
 * Toggle a model's favorite status.
 */
export function toggleFavorite(
  collections: ModelCollections,
  model: ModelRef,
): ModelCollections {
  if (isFavorite(collections, model)) {
    return removeFavorite(collections, model);
  }
  return addFavorite(collections, model);
}

/**
 * Record a model as recently used.
 *
 * Moves the model to the front of the recent list. If the list exceeds
 * maxRecent, the oldest entry is removed.
 */
export function recordRecent(
  collections: ModelCollections,
  model: ModelRef,
): ModelCollections {
  // Remove if already exists (to move to front).
  const filtered = collections.recent.filter(
    (r) => !(r.provider === model.provider && r.model === model.model),
  );
  // Add to front.
  const recent = [model, ...filtered].slice(0, collections.maxRecent);
  return {
    ...collections,
    recent,
  };
}

/**
 * Remove a model from recent.
 */
export function removeRecent(
  collections: ModelCollections,
  model: ModelRef,
): ModelCollections {
  return {
    ...collections,
    recent: collections.recent.filter(
      (r) => !(r.provider === model.provider && r.model === model.model),
    ),
  };
}

/**
 * Clear all recent models.
 */
export function clearRecent(collections: ModelCollections): ModelCollections {
  return {
    ...collections,
    recent: [],
  };
}

/**
 * Sort models by preference: favorites first, then recent, then alphabetical.
 */
export function sortModelsByPreference<T extends ModelRef>(
  models: T[],
  collections: ModelCollections,
): T[] {
  return [...models].sort((a, b) => {
    const aFav = isFavorite(collections, a) ? 0 : 1;
    const bFav = isFavorite(collections, b) ? 0 : 1;
    if (aFav !== bFav) return aFav - bFav;

    const aRecent = collections.recent.findIndex(
      (r) => r.provider === a.provider && r.model === a.model,
    );
    const bRecent = collections.recent.findIndex(
      (r) => r.provider === b.provider && r.model === b.model,
    );
    // Both recent: sort by recency (lower index = more recent).
    if (aRecent !== -1 && bRecent !== -1) return aRecent - bRecent;
    // Only one recent: it comes first.
    if (aRecent !== -1) return -1;
    if (bRecent !== -1) return 1;

    // Neither favorite nor recent: alphabetical by display name.
    const aName = a.displayName ?? a.model;
    const bName = b.displayName ?? b.model;
    return aName.localeCompare(bName);
  });
}
