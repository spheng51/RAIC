'use client';

import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/lib/hooks/use-i18n';

interface AccessCodeModalProps {
  open: boolean;
  onSuccess: () => void;
}

export function AccessCodeModal({ open, onSuccess }: AccessCodeModalProps) {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!code.trim() || loading) return;

    setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/access-code/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ code }),
      });

      if (!response.ok) {
        setError(t('accessCode.error'));
        setCode('');
        inputRef.current?.focus();
        return;
      }

      onSuccess();
    } catch {
      setError(t('accessCode.error'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open}>
      <DialogContent className="max-w-sm" showCloseButton={false}>
        <DialogTitle>{t('accessCode.title')}</DialogTitle>
        <DialogDescription>{t('accessCode.description')}</DialogDescription>
        <form className="space-y-4" onSubmit={handleSubmit}>
          <Input
            ref={inputRef}
            type="password"
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
              if (error) setError('');
            }}
            placeholder={t('accessCode.placeholder')}
            autoComplete="off"
            disabled={loading}
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button className="w-full" type="submit" disabled={!code.trim() || loading}>
            {loading ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {t('accessCode.submit')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
