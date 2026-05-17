'use client';

import { useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { createClient } from '@/lib/supabase/client';

export default function EnviarNFePage() {
  const [xmlFile, setXmlFile] = useState<File | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!xmlFile) {
      setError('Selecione o arquivo XML da NF-e');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      // Busca organization_id do fornecedor
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Não autenticado');

      const { data: supplier } = await supabase
        .from('business_partners')
        .select('group_id')
        .eq('supplier_user_id', user.id)
        .maybeSingle();

      if (!supplier) throw new Error('Fornecedor não encontrado');

      const formData = new FormData();
      formData.append('xml', xmlFile);
      if (pdfFile) formData.append('pdf', pdfFile);
      formData.append('organization_id', supplier.group_id);

      const idempotencyKey = uuidv4();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Sessão expirada');

      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/upload-fiscal-document`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Idempotency-Key': idempotencyKey,
          },
          body: formData,
        }
      );

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Erro ao enviar NF-e');
      }

      setSuccess(true);
      setXmlFile(null);
      setPdfFile(null);

      // Reset form
      const form = e.target as HTMLFormElement;
      form.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-semibold text-pink-600 mb-6">
        Enviar Nota Fiscal
      </h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Drag-drop zone pra XML */}
        <div className="border-2 border-dashed border-neutral-300 rounded-lg p-8 text-center hover:border-pink-500 transition-colors">
          <input
            type="file"
            accept=".xml,text/xml,application/xml"
            onChange={(e) => setXmlFile(e.target.files?.[0] || null)}
            className="hidden"
            id="xml-upload"
          />
          <label htmlFor="xml-upload" className="cursor-pointer">
            {xmlFile ? (
              <div>
                <p className="text-sm text-neutral-700 font-medium">{xmlFile.name}</p>
                <p className="text-xs text-neutral-500 mt-1">
                  {(xmlFile.size / 1024).toFixed(1)} KB
                </p>
              </div>
            ) : (
              <div>
                <svg
                  className="mx-auto h-12 w-12 text-neutral-400"
                  stroke="currentColor"
                  fill="none"
                  viewBox="0 0 48 48"
                  aria-hidden="true"
                >
                  <path
                    d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <p className="mt-2 text-sm text-neutral-600">
                  Clique para selecionar o <span className="font-medium">XML da NF-e</span>
                </p>
                <p className="text-xs text-neutral-500 mt-1">
                  Máximo 5MB
                </p>
              </div>
            )}
          </label>
        </div>

        {/* Upload opcional de PDF (boleto) */}
        <div className="border border-neutral-200 rounded-lg p-4 hover:border-pink-500 transition-colors">
          <input
            type="file"
            accept=".pdf,application/pdf"
            onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
            className="hidden"
            id="pdf-upload"
          />
          <label htmlFor="pdf-upload" className="cursor-pointer flex items-center gap-2">
            <svg
              className="h-5 w-5 text-neutral-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
              />
            </svg>
            <span className="text-sm text-neutral-600">
              {pdfFile ? (
                <span className="font-medium">{pdfFile.name}</span>
              ) : (
                'Anexar boleto (opcional)'
              )}
            </span>
          </label>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
            <p className="font-medium">Erro ao enviar NF-e</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        )}

        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg">
            <p className="font-medium">NF-e enviada com sucesso!</p>
            <p className="text-sm mt-1">Aguarde a análise do time financeiro.</p>
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !xmlFile}
          className="w-full bg-pink-600 text-white px-4 py-3 rounded-lg hover:bg-pink-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
        >
          {loading ? 'Enviando...' : 'Enviar NF-e'}
        </button>
      </form>

      <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h3 className="text-sm font-medium text-blue-900 mb-2">ℹ️ Informações Importantes</h3>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• O arquivo XML deve ser da NF-e emitida</li>
          <li>• O CNPJ destinatário deve corresponder à filial selecionada</li>
          <li>• O PDF do boleto é opcional mas recomendado</li>
          <li>• Após o envio, a NF será analisada pelo time financeiro</li>
        </ul>
      </div>
    </div>
  );
}
