export const SKIP_DIRS = new Set([
  'node_modules', '.git', '.venv', 'venv', '.env',
  'dist', 'out', 'build', '.cache',
  '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox'
]);

export const SKIP_EXTS = new Set([
  '.min.js', '.map', '.lock',
  '.png','.jpg','.jpeg','.gif','.svg','.ico',
  '.webp','.bmp','.tif','.tiff','.apng','.avif',
  '.pdf','.zip',
  '.pyc','.pyo','.whl','.so','.dll',
  '.class'
]);
