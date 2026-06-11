/**
 * @file utils.ts
 * @description Conjunto de funções utilitárias para formatação de dados, manipulação de classes CSS
 * e lógica auxiliar de interface do usuário para o Sistema GoMoto.
 * Este arquivo centraliza helper functions que garantem a consistência visual e de dados em todo o projeto.
 */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * @function cn
 * @description Utilitário para mesclar classes CSS de forma condicional e inteligente.
 * Combina as bibliotecas 'clsx' (para lógica condicional) e 'tailwind-merge' (para resolver conflitos
 * de especificidade do Tailwind CSS).
 * 
 * @param inputs - Lista de valores de classe que podem ser strings, objetos ou arrays.
 * @returns Uma string contendo as classes finais processadas.
 */
export function cn(...inputs: ClassValue[]) {
  // O processo envolve primeiro a resolução das condicionais com clsx
  // e depois a limpeza de duplicatas/conflitos com twMerge.
  return twMerge(clsx(inputs));
}

/**
 * @function formatCurrency
 * @description Formata um valor numérico para a representação de moeda brasileira (Real - BRL).
 * Utiliza a API nativa de internacionalização do JavaScript (Intl.NumberFormat).
 * 
 * @param value - O valor numérico a ser formatado.
 * @returns String formatada (ex: "R$ 1.250,00").
 */
export function formatCurrency(value: number): string {
  // Configuração explícita para o locale pt-BR e moeda BRL.
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

/**
 * @function formatDate
 * @description Converte uma string de data ou objeto Date em uma string formatada curta (DD/MM/AAAA).
 * Segue o padrão brasileiro de exibição de datas.
 * 
 * @param date - Objeto Date ou string representativa de data válida.
 * @returns String de data no formato local pt-BR.
 */
export function formatDate(date: string | Date): string {
  // A classe Intl.DateTimeFormat garante a formatação regional correta sem bibliotecas externas pesadas.
  return new Intl.DateTimeFormat('pt-BR').format(new Date(date));
}

