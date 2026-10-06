import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/** Brand panel beside a form panel; the sign-in and change-password forms are child routes. */
@Component({
  selector: 'app-login-page',
  imports: [RouterOutlet],
  templateUrl: './login-page.html',
  styleUrl: './login-page.css',
})
export class LoginPage {}
