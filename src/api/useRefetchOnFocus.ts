import { useFocusEffect } from '@react-navigation/native';
import type { QueryKey } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

/**
 * Refetch the given query keys whenever the screen comes into focus.
 * Pair with react-query's normal cache so we get stale-while-revalidate UX.
 */
export const useRefetchOnFocus = (keys: QueryKey[]): void => {
  const qc = useQueryClient();
  useFocusEffect(
    useCallback(() => {
      keys.forEach((key) => {
        void qc.invalidateQueries({ queryKey: key });
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [qc, JSON.stringify(keys)]),
  );
};
