import { useCallback, useEffect, useState } from 'react';

export function useApi(fetchData, deps) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchData());
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, deps);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, reload: load };
}

export function useAction() {
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  // Mengembalikan hasil aksi, atau null kalau gagal, supaya pemanggil bisa
  // memutuskan perlu reload atau pindah halaman.
  async function run(key, action, message) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const result = await action();
      setNotice(message);
      return result;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setBusy(null);
    }
  }

  return { busy, error, notice, run };
}
