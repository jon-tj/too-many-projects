import { Component, input } from '@angular/core';

@Component({
  selector: 'app-icon',
  template: '{{ name() }}',
  host: {
    class: 'material-symbols-outlined',
    'aria-hidden': 'true',
    '[style.font-size.px]': 'size()',
  },
  styles: ':host { display: inline-block; flex: 0 0 auto; width: 1em; height: 1em; line-height: 1; overflow: hidden; user-select: none; }',
})
export class Icon {
  readonly name = input.required<string>();
  readonly size = input(18);
}
