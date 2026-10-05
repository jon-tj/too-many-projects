import { Component } from '@angular/core';
import { Card } from '../components/card/card';

@Component({
  selector: 'app-root',
  imports: [Card],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {}
