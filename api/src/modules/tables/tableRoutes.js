import { Router } from 'express'

export const createTableRouter = (tableService) => {
  const router = Router()
  router.get('/', async (request, response, next) => {
    try { response.json(await tableService.list(request.query.date)) } catch (error) { next(error) }
  })
  router.patch('/:id/status', async (request, response, next) => {
    try { response.json(await tableService.updateStatus(request.params.id, request.body)) } catch (error) { next(error) }
  })
  return router
}
