import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'hexFormat',
})
export class HexFormatPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    if (!value) return '00';
    const cleaned = value.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
    if (!cleaned) return '00';
    const padded = cleaned.length % 2 === 1 ? `0${cleaned}` : cleaned;
    return padded.match(/.{1,2}/g)?.join(' ') ?? '00';
  }
}
