import express, { Application, Request, Response, NextFunction } from 'express'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import healthRouter from './routes/health'
import trainingSessionsRouter from './routes/training-sessions'
import adminRouter from './routes/admin'

const app: Application = express()

app.use(cors())
app.use(express.json())

app.use('/health', healthRouter)
app.use('/api/training-sessions', trainingSessionsRouter)
app.use('/api/admin', adminRouter)

const frontendDist = path.join(__dirname, '../../app/dist')
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist))
  // Client-side routes fall back to the SPA; unmatched API paths must still 404.
  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/api' || req.path.startsWith('/api/')) {
      next()
      return
    }
    res.sendFile(path.join(frontendDist, 'index.html'))
  })
}

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err)
  res.status(500).json({
    error: err.message,
    stack: err.stack,
    timestamp: new Date().toISOString(),
  })
})

export default app
