import { Lifecycle } from '@well-known-components/interfaces'
import { initComponents } from './components'
import { main } from './service'

// This file is the program entry point, it only calls the Lifecycle function
void Lifecycle.run({ main, initComponents })

process.on('uncaughtException', (err, _) => {
  console.log('Uncaught Exception', err)
})
process.on('unhandledRejection', (err, _) => {
  console.log('Uncaught Rejection', err)
})
