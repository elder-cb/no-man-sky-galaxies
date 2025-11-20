import {AfterViewInit, Component, computed, effect, OnInit, signal, Signal, viewChild} from '@angular/core'
import {MatTableDataSource, MatTableModule} from '@angular/material/table'
import {MatSort, MatSortModule} from '@angular/material/sort'
import {CommonModule} from '@angular/common'
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner'
import {Galaxy} from './model/galaxy.model'
import {galaxies} from '../assets/galaxies.json'
import {FormsModule} from '@angular/forms'
import {MatInputModule} from '@angular/material/input'
import {MatFormFieldModule} from '@angular/material/form-field'
import {MatSelectModule} from '@angular/material/select'
import {MatIconButton} from "@angular/material/button"
import {MatIcon} from "@angular/material/icon"

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    MatTableModule,
    MatSortModule,
    MatProgressSpinnerModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    FormsModule,
    MatIconButton,
    MatIcon
  ],
  providers: [],
  templateUrl: 'app.component.html',
  styleUrl: 'app.component.scss'
})
export class AppComponent implements OnInit, AfterViewInit {
  matSort: Signal<MatSort> = viewChild.required(MatSort)

  displayedColumns: string[] = ['id', 'name', 'type']
  dataSource!: MatTableDataSource<Galaxy>

  galaxyTypes: string[] = [] // Holds the distinct galaxy types
  selectedType = signal<string>('') // Model for the dropdown
  nameSearch = signal<string>('')
  filterValue = computed(() => {
    return {
      type: this.selectedType(),
      name: this.nameSearch()
    }
  })

  constructor() {
    effect(() => {
      if (this.dataSource) {
        this.dataSource.filter = JSON.stringify({
          type: this.selectedType(),
          name: this.nameSearch()
        })
      }
    });
  }

  ngOnInit(): void {
    this.dataSource = new MatTableDataSource(galaxies as unknown as Galaxy[])
    this.galaxyTypes = Array.from(new Set(galaxies.map(galaxy => galaxy.type)))
  }

  ngAfterViewInit() {
    this.dataSource.sort = this.matSort()

    this.dataSource.filterPredicate = (data: Galaxy, filter: string) => {
      const filters = JSON.parse(filter)
      return (
          !filters.name || data.name.toLowerCase().includes(filters.name.toLowerCase())) &&
        (!filters.type || data.type === filters.type)
    }

    this.dataSource.filter = JSON.stringify({
      type: this.selectedType(),
      name: this.nameSearch()
    })
  }

  clearNameSearch(): void {
    this.nameSearch.set('')
  }
}
