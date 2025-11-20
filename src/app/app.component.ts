import {AfterViewInit, Component, OnInit, Signal, viewChild} from '@angular/core';
import {MatTableDataSource, MatTableModule} from '@angular/material/table';
import {MatSort, MatSortModule} from '@angular/material/sort';
import {CommonModule} from '@angular/common';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {Galaxy} from './model/galaxy.model';
import {galaxies} from '../assets/galaxies.json'

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatSortModule,
    MatProgressSpinnerModule
  ],
  providers: [],
  templateUrl: 'app.component.html',
  styleUrl: 'app.component.scss'
})
export class AppComponent implements OnInit, AfterViewInit {
  displayedColumns: string[] = ['id', 'name', 'type'];
  dataSource!: MatTableDataSource<Galaxy>;

  matSort: Signal<MatSort> = viewChild.required(MatSort)

  constructor() {}

  ngOnInit(): void {
    this.dataSource = new MatTableDataSource(galaxies as unknown as Galaxy[]);
  }

  ngAfterViewInit() {
    this.dataSource.sort = this.matSort();
  }
}
